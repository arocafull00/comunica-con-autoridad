-- Booking flow with OK and recorded audios for new bookings with 24 hours or more:
--   booking_ok_request (template, OK button) → OK → booking_audio_1 (once)
--   → booking_confirm_request two hours after Meta accepts audio 1 (CONFIRMAR button)
--   → booking_2h template + booking_audio_2 only after OK and inside the 24-hour window → booking_15m.
-- The 24-hour reminder is not part of this flow. Short-notice rules are unchanged.
-- Existing bookings keep their jobs. The flow starts only after set_booking_audio_flow(true),
-- which requires both new Meta templates to be approved. No external notice or automatic cancellation.
select pg_advisory_xact_lock(8,0);

alter table public.followup_steps
  add column parameters text[] check (parameters <@ array['name','date','time','meetingUrl']::text[]);
alter table public.call_bookings
  add column whatsapp_flow text check (whatsapp_flow in ('legacy','audio')),
  add column ok_received_at timestamptz;
alter table public.whatsapp_settings add column booking_audio_flow boolean not null default false;
alter table private.followup_replies
  add column oks boolean not null default false,
  add column button_job_id uuid;

update public.call_bookings b set whatsapp_flow='legacy'
  where exists(select 1 from public.followup_jobs j where j.booking_uid=b.uid and j.booking_revision=b.revision);

-- Local reference copy; Meta serves the approved text. Audio steps send the files in public/whatsapp.
insert into public.followup_steps(key,channel,scope,delay_seconds,parameter,parameters,body)
select key,channel,scope,delay_seconds,null,parameters,body from jsonb_to_recordset($copy$[
  {"key":"booking_ok_request","channel":"whatsapp","scope":"booking","delay_seconds":0,"parameters":["name","date","time","meetingUrl"],
   "body":"¡Buenas, {{name}}!\nSoy el asistente virtual de Comunica con Autoridad. Hemos recibido correctamente tu solicitud para la sesión:\n\n🗓️ Fecha: {{date}}\n⏰ Hora: {{time}}\n💻 Videollamada: {{meetingUrl}}\n\nPulsa OK para confirmar que has recibido la información. Después recibirás un audio grabado por Ignacio en el que te explica cómo será el proceso."},
  {"key":"booking_audio_1","channel":"whatsapp","scope":"booking","delay_seconds":0,"parameters":null,
   "body":"Primer audio de Ignacio, enviado automáticamente al recibir OK."},
  {"key":"booking_confirm_request","channel":"whatsapp","scope":"booking","delay_seconds":7200,"parameters":["name","meetingUrl"],
   "body":"¡Hola de nuevo, {{name}}!\n\n✅ Tu sesión ya está reservada. Solo necesitamos que confirmes tu asistencia pulsando el botón de abajo.\n\nEnlace de la reunión >> {{meetingUrl}}\n\n⚠️ Importante: Trabajamos con plazas limitadas para las sesiones individuales. Si no recibimos tu confirmación, podremos liberar ese horario para otra persona."},
  {"key":"booking_audio_2","channel":"whatsapp","scope":"booking","delay_seconds":-7140,"parameters":null,
   "body":"Segundo audio de Ignacio, un minuto después del recordatorio de 2 horas."}
]$copy$::jsonb) as t(key text,channel text,scope text,delay_seconds integer,parameters text[],body text)
on conflict(key) do update set channel=excluded.channel,scope=excluded.scope,delay_seconds=excluded.delay_seconds,
  parameter=excluded.parameter,parameters=excluded.parameters,body=excluded.body;

create or replace function private.refresh_fixed_whatsapp_templates() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(8,0);
  insert into private.followup_templates(step,name,language,approved,verified_at)
    select f.step,f.name,f.language,coalesce(w.meta_status='APPROVED',false),clock_timestamp()
    from (values
      ('booking_confirmation','whatsapp_confirmacion_reserva','es'),
      ('booking_short_notice','reserva_menos_24hantes','en'),
      ('booking_24h','recordatorio_24hantes','en'),
      ('booking_2h','recordatorio_reunion_2h','es'),
      ('booking_15m','15_minutos_antes','en'),
      ('booking_ok_request','reserva_recibida_ok','es'),
      ('booking_confirm_request','reserva_confirmar_asistencia','es'),
      ('webinar_1h','seguimiento_webinar_1h','es'),
      ('webinar_1d','no_reservan_1dia_despues','es'),
      ('webinar_3d','seguimiento_no_reserva_3dia','en')
    ) as f(step,name,language)
    left join public.whatsapp_templates w on w.name=f.name and w.language=f.language
    on conflict(step) do update set name=excluded.name,language=excluded.language,
      approved=excluded.approved,verified_at=excluded.verified_at;
end;
$$;
revoke all on function private.refresh_fixed_whatsapp_templates() from public,anon,authenticated,service_role;
select private.refresh_fixed_whatsapp_templates();

-- Activation switch. Bookings keep the flow chosen when their revision was first scheduled.
create function public.set_booking_audio_flow(p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(8,0);
  if p_enabled is null then raise exception 'Invalid setting'; end if;
  if p_enabled and (select count(*) from private.followup_templates t
      join public.whatsapp_templates w on w.name=t.name and w.language=t.language
      where t.step in ('booking_ok_request','booking_confirm_request') and t.approved and w.meta_status='APPROVED')<>2 then
    raise exception 'Approved booking audio templates required';
  end if;
  update public.whatsapp_settings set booking_audio_flow=p_enabled where singleton;
end;
$$;
revoke all on function public.set_booking_audio_flow(boolean) from public,anon,authenticated;
grant execute on function public.set_booking_audio_flow(boolean) to service_role;

-- The flow is chosen once per booking revision, when its first jobs are created.
-- Bookings with 24 hours or more use the audio flow while it is active; others keep the legacy rules.
create or replace function private.schedule_call_followups(p_uid text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.call_bookings; l public.leads; v_now timestamptz:=clock_timestamp();
  v_short boolean; v_under_two boolean; v_flow text;
begin
  select * into b from public.call_bookings where uid=p_uid;
  if not found or b.status<>'booked' or b.registration_id is null or b.start_time<=v_now then return; end if;
  select lead.* into l from public.leads lead join public.webinar_registrations r on r.lead_id=lead.id
    where r.id=b.registration_id;
  if l.phone is null or not l.whatsapp_consent then return; end if;
  v_short:=b.start_time<b.last_event_at-make_interval(secs=>(select delay_seconds from public.followup_steps where key='booking_24h'));
  v_under_two:=b.start_time<b.last_event_at-make_interval(secs=>(select delay_seconds from public.followup_steps where key='booking_2h'));
  if exists(select 1 from public.followup_jobs where booking_uid=b.uid and booking_revision=b.revision) then
    v_flow:=coalesce(b.whatsapp_flow,'legacy');
  else
    v_flow:=case when not v_short and (select booking_audio_flow from public.whatsapp_settings where singleton) then 'audio' else 'legacy' end;
    update public.call_bookings set whatsapp_flow=v_flow where uid=b.uid;
  end if;
  insert into public.followup_jobs(registration_id,step,booking_uid,booking_revision,scheduled_at,expires_at,status,last_error)
    select b.registration_id,s.key,b.uid,b.revision,s.due_at,
      case when s.immediate then b.start_time else least(b.start_time,s.due_at+interval '30 minutes') end,
      case when s.reason is null then 'pending' else 'suppressed' end,s.reason
    from (
      select f.key,f.immediate,
        case when f.immediate then v_now else b.start_time+make_interval(secs=>f.delay_seconds) end as due_at,
        case
          when v_flow='legacy' and v_under_two and f.key<>'booking_15m' then 'not_needed_short_notice'
          when f.key='booking_confirmation' and v_short then 'not_needed_variant'
          when f.key='booking_short_notice' and not v_short then 'not_needed_variant'
          when not f.immediate and b.start_time+make_interval(secs=>f.delay_seconds)<=v_now then 'reminder_time_elapsed'
          else null end as reason
      from (select s.*,s.key in ('booking_confirmation','booking_short_notice','booking_ok_request') as immediate
        from public.followup_steps s where s.scope='booking' and (
          (v_flow='legacy' and s.key in ('booking_confirmation','booking_short_notice','booking_24h','booking_2h','booking_15m')) or
          (v_flow='audio' and s.key in ('booking_ok_request','booking_2h','booking_audio_2','booking_15m')))) f
    ) s
    on conflict do nothing;
end;
$$;

-- An OK for the current revision records receipt and queues the first audio once.
create function private.record_booking_ok(p_uid text,p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.call_bookings;
begin
  update public.call_bookings set ok_received_at=coalesce(ok_received_at,p_at) where uid=p_uid returning * into b;
  insert into public.followup_jobs(registration_id,step,booking_uid,booking_revision,scheduled_at,expires_at)
    values(b.registration_id,'booking_audio_1',b.uid,b.revision,clock_timestamp(),
      least(b.start_time,p_at+interval '23 hours 55 minutes'))
    on conflict do nothing;
end;
$$;
revoke all on function private.record_booking_ok(text,timestamptz) from public,anon,authenticated,service_role;

-- Buttons carry the job id, which binds the reply to that booking revision.
-- A button from an older revision or another phone changes nothing. Typed CONFIRMO,
-- CONFIRMAR or OK only applies when a single future booking matches.
create or replace function public.record_whatsapp_replies(p_messages jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare m jsonb; r public.webinar_registrations; v_time timestamptz; v_booking text; v_count integer;
  v_job uuid; j public.followup_jobs; b public.call_bookings;
begin
  perform pg_advisory_xact_lock(8,0);
  if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>1000 then raise exception 'Invalid replies'; end if;
  for m in select value from jsonb_array_elements(p_messages) loop
    v_time:=(m->>'receivedAt')::timestamptz;
    v_job:=case when m->>'buttonJobId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (m->>'buttonJobId')::uuid end;
    insert into private.followup_replies(provider_id,phone,received_at,confirms,opts_out,oks,button_job_id)
      values(m->>'id',m->>'phone',v_time,coalesce((m->>'confirms')::boolean,false),coalesce((m->>'optsOut')::boolean,false),
        coalesce((m->>'oks')::boolean,false),v_job) on conflict do nothing;
    if not found then continue; end if;
    if coalesce((m->>'optsOut')::boolean,false) then update public.leads set whatsapp_consent=false where phone=m->>'phone'; end if;
    for r in select wr.* from public.webinar_registrations wr join public.leads l on l.id=wr.lead_id
      where l.phone=m->>'phone' and wr.registered_at<=v_time loop
      update public.webinar_registrations set whatsapp_replied_at=greatest(whatsapp_replied_at,v_time) where id=r.id;
      update public.followup_jobs set status='suppressed',last_error='contact_replied'
        where registration_id=r.id and step='webinar_3d' and status='pending';
    end loop;
    if coalesce((m->>'optsOut')::boolean,false) then continue; end if;
    if v_job is not null then
      select * into j from public.followup_jobs where id=v_job and booking_uid is not null
        and step in ('booking_ok_request','booking_confirm_request') and payload->>'phone'=m->>'phone';
      if found then
        select * into b from public.call_bookings where uid=j.booking_uid;
        if b.status='booked' and b.revision=j.booking_revision and b.start_time>v_time and b.last_event_at<=v_time then
          if j.step='booking_ok_request' then perform private.record_booking_ok(b.uid,v_time);
          else update public.call_bookings set confirmed_at=coalesce(confirmed_at,v_time) where uid=b.uid;
          end if;
        end if;
      end if;
    elsif coalesce((m->>'confirms')::boolean,false) then
      select count(*),min(c.uid) into v_count,v_booking from public.call_bookings c
        join public.webinar_registrations wr on wr.id=c.registration_id join public.leads l on l.id=wr.lead_id
        where l.phone=m->>'phone' and c.status='booked' and c.start_time>v_time;
      if v_count=1 then update public.call_bookings set confirmed_at=v_time where uid=v_booking and last_event_at<=v_time; end if;
    elsif coalesce((m->>'oks')::boolean,false) then
      select count(*),min(c.uid) into v_count,v_booking from public.call_bookings c
        join public.webinar_registrations wr on wr.id=c.registration_id join public.leads l on l.id=wr.lead_id
        where l.phone=m->>'phone' and c.status='booked' and c.start_time>v_time and c.whatsapp_flow='audio'
          and c.ok_received_at is null and c.last_event_at<=v_time
          and exists(select 1 from public.followup_jobs oj where oj.booking_uid=c.uid and oj.booking_revision=c.revision
            and oj.step='booking_ok_request' and oj.status='sent' and oj.sent_at<=v_time);
      if v_count=1 then perform private.record_booking_ok(v_booking,v_time); end if;
    end if;
  end loop;
end;
$$;

-- A changed booking revision needs a new OK, as it already needs a new confirmation.
create or replace function public.record_cal_booking(p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_revision integer; v_result jsonb;
begin
  perform pg_advisory_xact_lock(8,0);
  if p_event->>'event'='BOOKING_CREATED' and exists(
    select 1 from public.call_bookings where uid=p_event->>'uid' and status='cancelled'
  ) then return jsonb_build_object('outcome','ignored'); end if;
  select revision into v_revision from public.call_bookings where uid=p_event->>'uid';
  v_result:=private.record_cal_booking_base(p_event);
  update public.call_bookings set ok_received_at=null
    where uid=p_event->>'uid' and ok_received_at is not null and revision is distinct from v_revision;
  return v_result;
end;
$$;

-- The confirmation request is programmed from the moment Meta accepts the first audio.
create or replace function public.finish_followup_job(p_id uuid,p_token uuid,p_outcome text,p_provider_id text default null,p_error text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j public.followup_jobs; b public.call_bookings; v_now timestamptz:=clock_timestamp(); v_due timestamptz;
begin
  perform pg_advisory_xact_lock(8,0);
  select * into j from public.followup_jobs where id=p_id for update;
  if not found or j.status<>'processing' or j.claim_token is distinct from p_token then return false; end if;
  if p_outcome not in ('sent','retry','failed','unknown') or p_outcome is null then raise exception 'Invalid outcome'; end if;
  if p_outcome='sent' and nullif(p_provider_id,'') is null then raise exception 'Provider id required'; end if;
  update public.followup_jobs set
    status=case when p_outcome='sent' then 'sent' when p_outcome='retry' and attempts<3 then 'pending' else 'failed' end,
    provider_message_id=p_provider_id,sent_at=case when p_outcome='sent' then v_now end,
    last_error=case when p_outcome='unknown' then 'delivery_unknown' when p_outcome='sent' then null else left(p_error,120) end,
    scheduled_at=case when p_outcome='retry' then v_now+case when attempts=1 then interval '60 seconds' else interval '5 minutes' end else scheduled_at end,
    processing_started_at=null,claim_token=null where id=p_id;
  update private.followup_slots set job_id=null,token=null,leased_until=null where job_id=p_id and token=p_token;
  if p_outcome='sent' and j.step='booking_audio_1' then
    select * into b from public.call_bookings where uid=j.booking_uid;
    if b.status='booked' and b.revision=j.booking_revision then
      v_due:=v_now+make_interval(secs=>(select delay_seconds from public.followup_steps where key='booking_confirm_request'));
      insert into public.followup_jobs(registration_id,step,booking_uid,booking_revision,scheduled_at,expires_at,status,last_error)
        values(j.registration_id,'booking_confirm_request',j.booking_uid,j.booking_revision,v_due,b.start_time,
          case when b.confirmed_at is null and v_due<b.start_time then 'pending' else 'suppressed' end,
          case when b.confirmed_at is not null then 'already_confirmed' when v_due>=b.start_time then 'call_started' end)
        on conflict do nothing;
    end if;
  end if;
  return true;
end;
$$;

-- Same checks as before, plus: audio steps need no template but an open 24-hour window,
-- the second audio needs an OK for the current revision, and confirmed bookings skip the request.
create or replace function private.claim_followup_job_base(p_job_id uuid,p_email boolean,p_whatsapp boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.followup_jobs; s public.followup_steps; r public.webinar_registrations;
  l public.leads; b public.call_bookings; t private.followup_templates; w public.whatsapp_templates;
  v_reason text; v_now timestamptz:=clock_timestamp(); v_slot integer; v_token uuid:=gen_random_uuid();
  v_time text; v_payload jsonb; v_audio boolean;
begin
  perform pg_advisory_xact_lock(8,0);
  select * into j from public.followup_jobs where id=p_job_id for update;
  if not found or j.status not in ('pending','processing') then return jsonb_build_object('action','skip'); end if;
  if j.test_mode and not exists(select 1 from private.whatsapp_followup_test c join public.webinar_registrations test_registration on test_registration.id=j.registration_id join public.leads test_lead on test_lead.id=test_registration.lead_id where c.enabled and c.phone=test_lead.phone) then return jsonb_build_object('action','paused'); end if;
  if j.status='processing' then
    if j.processing_started_at>v_now-interval '120 seconds' then return jsonb_build_object('action','busy'); end if;
    update public.followup_jobs set status='failed',last_error='delivery_unknown' where id=j.id;
    update private.followup_slots set job_id=null,token=null,leased_until=null where job_id=j.id;
    return jsonb_build_object('action','unknown');
  end if;
  select * into s from public.followup_steps where key=j.step;
  v_audio:=s.key in ('booking_audio_1','booking_audio_2');
  if (s.channel='email' and not p_email) or (s.channel='whatsapp' and not p_whatsapp) then return jsonb_build_object('action','paused'); end if;
  if j.scheduled_at>v_now then return jsonb_build_object('action','busy'); end if;
  select * into r from public.webinar_registrations where id=j.registration_id;
  select * into l from public.leads where id=r.lead_id;
  if s.channel='email' and (r.email_unsubscribed_at is not null or not l.communications_consent) then v_reason:='email_consent_missing';
  elsif s.channel='whatsapp' and not l.whatsapp_consent then v_reason:='consent_missing';
  elsif j.expires_at<=v_now then v_reason:='schedule_expired';
  elsif j.step in ('webinar_1h','webinar_1d','webinar_3d') and exists(select 1 from public.call_bookings where registration_id=r.id) then v_reason:='call_already_booked';
  elsif j.step='webinar_3d' and r.whatsapp_replied_at is not null then v_reason:='contact_replied';
  end if;
  if j.booking_uid is not null then
    select * into b from public.call_bookings where uid=j.booking_uid;
    if b.status<>'booked' or b.revision<>j.booking_revision or b.start_time<=v_now then v_reason:='booking_changed';
    elsif v_reason is null and j.step='booking_confirm_request' and b.confirmed_at is not null then v_reason:='already_confirmed';
    elsif v_reason is null and j.step='booking_audio_2' and b.ok_received_at is null then v_reason:='ok_not_received';
    elsif v_reason is null and v_audio and not exists(select 1 from private.followup_replies
      where phone=l.phone and received_at>v_now-interval '23 hours 55 minutes') then v_reason:='whatsapp_window_closed';
    end if;
  end if;
  if v_reason is not null then
    update public.followup_jobs set status='suppressed',last_error=v_reason where id=j.id;
    return jsonb_build_object('action','skip');
  end if;
  if j.step='booking_2h' and b.meeting_url is null then
    update public.followup_jobs set last_error='missing_meeting_url' where id=j.id;
    return jsonb_build_object('action','missing_meeting_url');
  end if;
  if s.channel='whatsapp' and not j.test_mode then
    if not (select enabled from public.whatsapp_settings where singleton) then return jsonb_build_object('action','paused'); end if;
    if not v_audio then
      select f.* into t from private.followup_templates f join public.whatsapp_templates c on c.name=f.name and c.language=f.language where f.step=s.key and f.approved and c.meta_status='APPROVED';
      if not found then
        update public.followup_jobs set last_error='missing_template' where id=j.id;
        return jsonb_build_object('action','missing_template');
      end if;
      if j.payload is not null and (j.payload->>'templateName',j.payload->>'templateLanguage') is distinct from (t.name,t.language) then
        return jsonb_build_object('action','missing_template');
      end if;
      select * into w from public.whatsapp_templates where name=t.name and language=t.language;
    end if;
  end if;
  select slot into v_slot from private.followup_slots where leased_until is null or leased_until<=v_now order by slot limit 1 for update skip locked;
  if not found then return jsonb_build_object('action','busy'); end if;
  v_time:=case when b.uid is not null then to_char(b.start_time at time zone b.time_zone,'HH24:MI')||' ('||b.time_zone||')' else '' end;
  v_payload:=coalesce(j.payload,jsonb_build_object('id',j.id,'registrationId',r.id,'channel',s.channel,'step',s.key,
    'email',r.email,'phone',l.phone,'name',l.name,'time',v_time,'meetingUrl',b.meeting_url,
    'startTime',b.start_time,'timeZone',b.time_zone,
    'kind',case when v_audio and not j.test_mode then 'audio' else 'template' end,
    'subject',s.subject,'body',coalesce(w.body,s.body),'templateComponents',w.components,'parameter',case when j.test_mode then null else s.parameter end,
    'parameters',case when j.test_mode then null else to_jsonb(s.parameters) end,
    'templateName',case when j.test_mode then 'hello_world' else t.name end,
    'templateLanguage',case when j.test_mode then 'en_US' else t.language end,'testMode',j.test_mode));
  update public.followup_jobs set status='processing',attempts=attempts+1,claim_token=v_token,
    processing_started_at=v_now,payload=v_payload where id=j.id;
  update private.followup_slots set job_id=j.id,token=v_token,leased_until=v_now+interval '120 seconds' where slot=v_slot;
  return jsonb_build_object('action','claimed','claimToken',v_token,'message',v_payload);
end;
$$;
