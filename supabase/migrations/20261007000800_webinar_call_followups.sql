-- Explicit webinar access, signed Cal events, and durable follow-up delivery.
-- No historical leads are enrolled and no external sending is activated here.
create table public.webinar_registrations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  email text not null unique check (email = lower(email)),
  registered_at timestamptz not null default clock_timestamp(),
  email_unsubscribed_at timestamptz,
  whatsapp_replied_at timestamptz
);
create table public.call_bookings (
  uid text primary key check (char_length(uid) between 1 and 200),
  registration_id uuid references public.webinar_registrations(id) on delete set null,
  email text not null,
  start_time timestamptz not null,
  end_time timestamptz not null check (end_time > start_time),
  time_zone text not null,
  meeting_url text,
  status text not null check (status in ('booked','cancelled','rescheduled')),
  confirmed_at timestamptz,
  last_event_at timestamptz not null,
  revision integer not null default 1,
  replaced_by text,
  created_at timestamptz not null default clock_timestamp()
);
create index call_bookings_email on public.call_bookings(email);
create index call_bookings_registration on public.call_bookings(registration_id);
create table public.followup_steps (
  key text primary key,
  channel text not null check (channel in ('email','whatsapp')),
  scope text not null check (scope in ('webinar','booking')),
  delay_seconds integer not null,
  subject text,
  body text not null,
  parameter text check (parameter in ('name','time','meetingUrl'))
);
create table public.followup_jobs (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.webinar_registrations(id) on delete cascade,
  step text not null references public.followup_steps(key),
  booking_uid text references public.call_bookings(uid) on delete cascade,
  booking_revision integer,
  scheduled_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','suppressed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  claim_token uuid,
  processing_started_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  payload jsonb,
  check ((booking_uid is null) = (booking_revision is null))
);
create unique index followup_webinar_once on public.followup_jobs(registration_id,step) where booking_uid is null;
create unique index followup_booking_once on public.followup_jobs(booking_uid,booking_revision,step) where booking_uid is not null;
create index followup_jobs_due on public.followup_jobs(status,scheduled_at);
create table private.followup_templates (
  step text primary key references public.followup_steps(key),
  name text not null check (name ~ '^[a-z0-9_]+$' and char_length(name) <= 512),
  language text not null check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  approved boolean not null default false,
  verified_at timestamptz not null default clock_timestamp()
);
create table private.followup_replies (
  provider_id text primary key,
  phone text not null,
  received_at timestamptz not null,
  confirms boolean not null,
  opts_out boolean not null
);
create index followup_replies_phone on private.followup_replies(phone,received_at);
create table private.followup_slots (
  slot integer primary key check (slot in (1,2)),
  job_id uuid references public.followup_jobs(id) on delete set null,
  token uuid,
  leased_until timestamptz
);
insert into private.followup_slots(slot) values (1),(2);

alter table public.webinar_registrations enable row level security;
alter table public.call_bookings enable row level security;
alter table public.followup_steps enable row level security;
alter table public.followup_jobs enable row level security;
alter table private.followup_templates enable row level security;
alter table private.followup_replies enable row level security;
alter table private.followup_slots enable row level security;
revoke all on public.webinar_registrations, public.call_bookings, public.followup_steps, public.followup_jobs from public,anon,authenticated,service_role;
grant select on public.webinar_registrations, public.call_bookings, public.followup_steps, public.followup_jobs to service_role;

-- The full-form flow replaces the old immediate welcome. Legacy API clients retain it.
create or replace function private.enqueue_lead_welcome() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_message_id uuid;
begin
  if new.whatsapp_consent and new.profession is null then
    insert into public.whatsapp_messages(lead_id) values (new.id) returning id into v_message_id;
    perform pgmq.send('whatsapp_outbound', jsonb_build_object('messageId',v_message_id));
  end if;
  return new;
end;
$$;

-- One transaction lock serializes registration/booking/reply/claim decisions.
-- Network delivery happens outside that transaction, with two shared leases.
create function private.schedule_call_followups(p_uid text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.call_bookings; v_now timestamptz := clock_timestamp();
begin
  select * into b from public.call_bookings where uid=p_uid;
  if not found or b.status <> 'booked' or b.registration_id is null or b.start_time <= v_now then return; end if;
  insert into public.followup_jobs(registration_id,step,booking_uid,booking_revision,scheduled_at,expires_at)
    select b.registration_id,s.key,b.uid,b.revision,
      case when s.key='booking_confirmation' then v_now else b.start_time+make_interval(secs=>s.delay_seconds) end,
      case when s.key='booking_confirmation' then b.start_time
        else least(b.start_time,b.start_time+make_interval(secs=>s.delay_seconds)+interval '30 minutes') end
    from public.followup_steps s where s.scope='booking'
      and (s.key='booking_confirmation' or b.start_time+make_interval(secs=>s.delay_seconds) > v_now)
    on conflict do nothing;
end;
$$;

create function public.register_webinar(p_submission_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.leads; r public.webinar_registrations; b public.call_bookings;
begin
  perform pg_advisory_xact_lock(8,0);
  select * into l from public.leads where idempotency_key=p_submission_id;
  if not found or l.profession is null or l.situation is null or l.goal is null then raise exception 'Completed form required'; end if;
  insert into public.webinar_registrations(lead_id,email) values(l.id,l.email)
    on conflict(email) do nothing returning * into r;
  if not found then select * into r from public.webinar_registrations where email=l.email; return r.id; end if;
  update public.webinar_registrations set whatsapp_replied_at=(select max(received_at) from private.followup_replies where phone=l.phone and received_at>=r.registered_at)
    where id=r.id;
  insert into public.followup_jobs(registration_id,step,scheduled_at,expires_at)
    select r.id,s.key,r.registered_at+make_interval(secs=>s.delay_seconds),
      r.registered_at+make_interval(secs=>s.delay_seconds)+interval '6 hours'
    from public.followup_steps s where s.scope='webinar'
      and ((s.channel='whatsapp' and l.whatsapp_consent) or (s.channel='email' and l.communications_consent));
  -- Bookings can arrive before the form or before the Sheets copy succeeds.
  update public.call_bookings set registration_id=r.id where email=l.email and registration_id is null;
  if exists(select 1 from public.call_bookings where registration_id=r.id) then
    update public.followup_jobs set status='suppressed',last_error='call_already_booked'
      where registration_id=r.id and step in ('webinar_1h','webinar_1d','webinar_3d') and status='pending';
  end if;
  for b in select * from public.call_bookings where registration_id=r.id and status='booked' loop
    perform private.schedule_call_followups(b.uid);
  end loop;
  return r.id;
end;
$$;

create function public.record_cal_booking(p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.call_bookings; v_registration uuid; v_previous text := nullif(p_event->>'previousUid','');
  v_uid text := p_event->>'uid'; v_at timestamptz := (p_event->>'eventAt')::timestamptz;
  v_status text; v_revision integer; v_changed boolean;
begin
  perform pg_advisory_xact_lock(8,0);
  if p_event->>'event' not in ('BOOKING_CREATED','BOOKING_RESCHEDULED','BOOKING_CANCELLED')
    or v_uid is null or v_at is null then raise exception 'Invalid event'; end if;
  select * into b from public.call_bookings where uid=v_uid;
  if found and (b.last_event_at>=v_at or b.status='rescheduled') then return jsonb_build_object('outcome','ignored'); end if;
  if v_previous is not null and v_previous<>v_uid and exists(
    select 1 from public.call_bookings where uid=v_previous and last_event_at>v_at) then
    return jsonb_build_object('outcome','ignored');
  end if;
  v_changed := b.uid is null or (b.start_time,b.end_time,b.meeting_url) is distinct from
    ((p_event->>'startTime')::timestamptz,(p_event->>'endTime')::timestamptz,p_event->>'meetingUrl');
  v_revision := coalesce(b.revision,0)+case when v_changed then 1 else 0 end;
  v_status := case when p_event->>'event'='BOOKING_CANCELLED' then 'cancelled' else 'booked' end;
  select id into v_registration from public.webinar_registrations where email=lower(p_event->>'email');
  insert into public.call_bookings(uid,registration_id,email,start_time,end_time,time_zone,meeting_url,status,last_event_at,revision)
    values(v_uid,v_registration,lower(p_event->>'email'),(p_event->>'startTime')::timestamptz,
      (p_event->>'endTime')::timestamptz,p_event->>'timeZone',p_event->>'meetingUrl',v_status,v_at,v_revision)
    on conflict(uid) do update set registration_id=excluded.registration_id,email=excluded.email,
      start_time=excluded.start_time,end_time=excluded.end_time,time_zone=excluded.time_zone,meeting_url=excluded.meeting_url,
      status=excluded.status,last_event_at=excluded.last_event_at,revision=excluded.revision,
      confirmed_at=case when v_changed then null else public.call_bookings.confirmed_at end;
  -- Keep a tombstone even if a reschedule arrives before the original create webhook.
  if v_previous is not null and v_previous<>v_uid then
    insert into public.call_bookings(uid,registration_id,email,start_time,end_time,time_zone,status,last_event_at,replaced_by)
      values(v_previous,v_registration,lower(p_event->>'email'),(p_event->>'startTime')::timestamptz,
        (p_event->>'endTime')::timestamptz,p_event->>'timeZone','rescheduled',v_at,v_uid)
      on conflict(uid) do update set status='rescheduled',last_event_at=v_at,replaced_by=v_uid,confirmed_at=null;
    update public.followup_jobs set status='suppressed',last_error='call_rescheduled'
      where booking_uid=v_previous and status='pending';
  end if;
  if v_changed or v_status='cancelled' then
    update public.followup_jobs set status='suppressed',last_error='booking_changed'
      where booking_uid=v_uid and status='pending';
  end if;
  update public.followup_jobs set status='suppressed',last_error='call_already_booked'
    where registration_id=v_registration and step in ('webinar_1h','webinar_1d','webinar_3d') and status='pending';
  perform private.schedule_call_followups(v_uid);
  return jsonb_build_object('outcome','saved','matched',v_registration is not null);
end;
$$;

create function public.record_whatsapp_replies(p_messages jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare m jsonb; r public.webinar_registrations; v_time timestamptz; v_booking text; v_count integer;
begin
  perform pg_advisory_xact_lock(8,0);
  if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>1000 then raise exception 'Invalid replies'; end if;
  for m in select value from jsonb_array_elements(p_messages) loop
    v_time := (m->>'receivedAt')::timestamptz;
    insert into private.followup_replies(provider_id,phone,received_at,confirms,opts_out)
      values(m->>'id',m->>'phone',v_time,(m->>'confirms')::boolean,(m->>'optsOut')::boolean) on conflict do nothing;
    if not found then continue; end if;
    if (m->>'optsOut')::boolean then
      update public.leads set whatsapp_consent=false where phone=m->>'phone';
    end if;
    for r in select wr.* from public.webinar_registrations wr join public.leads l on l.id=wr.lead_id
      where l.phone=m->>'phone' and wr.registered_at<=v_time loop
      update public.webinar_registrations set whatsapp_replied_at=greatest(whatsapp_replied_at,v_time) where id=r.id;
      update public.followup_jobs set status='suppressed',last_error='contact_replied'
        where registration_id=r.id and step='webinar_3d' and status='pending';
      if (m->>'confirms')::boolean then
        -- An ambiguous CONFIRMO never confirms several appointments at once.
        select count(*),min(uid) into v_count,v_booking from public.call_bookings
          where registration_id=r.id and status='booked' and start_time>v_time and last_event_at<=v_time;
        if v_count=1 then update public.call_bookings set confirmed_at=v_time where uid=v_booking; end if;
      end if;
    end loop;
  end loop;
end;
$$;

create function public.unsubscribe_webinar_email(p_registration_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(8,0);
  update public.webinar_registrations set email_unsubscribed_at=coalesce(email_unsubscribed_at,clock_timestamp()) where id=p_registration_id;
  update public.followup_jobs j set status='suppressed',last_error='email_unsubscribed'
    from public.followup_steps s where j.registration_id=p_registration_id and j.step=s.key and s.channel='email' and j.status='pending';
end;
$$;

create function public.read_followup_jobs(p_email boolean,p_whatsapp boolean) returns table(id uuid)
language sql security definer set search_path = '' as $$
  select j.id from public.followup_jobs j join public.followup_steps s on s.key=j.step
    where ((s.channel='email' and p_email) or (s.channel='whatsapp' and p_whatsapp))
      and ((j.status='pending' and j.scheduled_at<=clock_timestamp()) or
        (j.status='processing' and j.processing_started_at<clock_timestamp()-interval '120 seconds'))
    order by j.scheduled_at limit 10;
$$;

create function public.claim_followup_job(p_job_id uuid,p_email boolean,p_whatsapp boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.followup_jobs; s public.followup_steps; r public.webinar_registrations;
  l public.leads; b public.call_bookings; t private.followup_templates;
  v_reason text; v_now timestamptz:=clock_timestamp(); v_slot integer; v_token uuid:=gen_random_uuid();
  v_time text; v_payload jsonb;
begin
  perform pg_advisory_xact_lock(8,0);
  select * into j from public.followup_jobs where id=p_job_id for update;
  if not found or j.status not in ('pending','processing') then return jsonb_build_object('action','skip'); end if;
  if j.status='processing' then
    if j.processing_started_at>v_now-interval '120 seconds' then return jsonb_build_object('action','busy'); end if;
    update public.followup_jobs set status='failed',last_error='delivery_unknown' where id=j.id;
    update private.followup_slots set job_id=null,token=null,leased_until=null where job_id=j.id;
    return jsonb_build_object('action','unknown');
  end if;
  select * into s from public.followup_steps where key=j.step;
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
    if b.status<>'booked' or b.revision<>j.booking_revision or b.start_time<=v_now then v_reason:='booking_changed'; end if;
  end if;
  if v_reason is not null then
    update public.followup_jobs set status='suppressed',last_error=v_reason where id=j.id;
    return jsonb_build_object('action','skip');
  end if;
  if j.step='booking_2h' and b.meeting_url is null then
    update public.followup_jobs set last_error='missing_meeting_url' where id=j.id;
    return jsonb_build_object('action','missing_meeting_url');
  end if;
  if s.channel='whatsapp' then
    if not (select enabled from public.whatsapp_settings where singleton) then return jsonb_build_object('action','paused'); end if;
    select * into t from private.followup_templates where step=s.key and approved;
    if not found then
      update public.followup_jobs set last_error='missing_template' where id=j.id;
      return jsonb_build_object('action','missing_template');
    end if;
    if j.payload is not null and (j.payload->>'templateName',j.payload->>'templateLanguage') is distinct from (t.name,t.language) then
      return jsonb_build_object('action','missing_template');
    end if;
  end if;
  select slot into v_slot from private.followup_slots where leased_until is null or leased_until<=v_now order by slot limit 1 for update skip locked;
  if not found then return jsonb_build_object('action','busy'); end if;
  v_time:=case when b.uid is not null then to_char(b.start_time at time zone b.time_zone,'HH24:MI')||' ('||b.time_zone||')' else '' end;
  v_payload:=coalesce(j.payload,jsonb_build_object('id',j.id,'registrationId',r.id,'channel',s.channel,'step',s.key,
    'email',r.email,'phone',l.phone,'name',l.name,'time',v_time,'meetingUrl',b.meeting_url,
    'subject',s.subject,'body',s.body,'parameter',s.parameter,'templateName',t.name,'templateLanguage',t.language));
  update public.followup_jobs set status='processing',attempts=attempts+1,claim_token=v_token,
    processing_started_at=v_now,payload=v_payload where id=j.id;
  update private.followup_slots set job_id=j.id,token=v_token,leased_until=v_now+interval '120 seconds' where slot=v_slot;
  return jsonb_build_object('action','claimed','claimToken',v_token,'message',v_payload);
end;
$$;

create function public.finish_followup_job(p_id uuid,p_token uuid,p_outcome text,p_provider_id text default null,p_error text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j public.followup_jobs;
begin
  perform pg_advisory_xact_lock(8,0);
  select * into j from public.followup_jobs where id=p_id for update;
  if not found or j.status<>'processing' or j.claim_token is distinct from p_token then return false; end if;
  if p_outcome not in ('sent','retry','failed','unknown') or p_outcome is null then raise exception 'Invalid outcome'; end if;
  if p_outcome='sent' and nullif(p_provider_id,'') is null then raise exception 'Provider id required'; end if;
  update public.followup_jobs set
    status=case when p_outcome='sent' then 'sent' when p_outcome='retry' and attempts<3 then 'pending' else 'failed' end,
    provider_message_id=p_provider_id,sent_at=case when p_outcome='sent' then clock_timestamp() end,
    last_error=case when p_outcome='unknown' then 'delivery_unknown' when p_outcome='sent' then null else left(p_error,120) end,
    scheduled_at=case when p_outcome='retry' then clock_timestamp()+case when attempts=1 then interval '60 seconds' else interval '5 minutes' end else scheduled_at end,
    processing_started_at=null,claim_token=null where id=p_id;
  update private.followup_slots set job_id=null,token=null,leased_until=null where job_id=p_id and token=p_token;
  return true;
end;
$$;

-- Only a verified, approved, plain-body Meta template matching our draft is accepted.
create function public.sync_followup_templates(p_templates jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare t jsonb; s public.followup_steps;
begin
  perform pg_advisory_xact_lock(8,0);
  if jsonb_typeof(p_templates)<>'array' or jsonb_array_length(p_templates)>7 then raise exception 'Invalid templates'; end if;
  update private.followup_templates set approved=false,verified_at=clock_timestamp();
  for t in select value from jsonb_array_elements(p_templates) loop
    select * into s from public.followup_steps where key=t->>'step' and channel='whatsapp';
    if not found or t->>'body' is distinct from replace(s.body,'{{'||coalesce(s.parameter,'')||'}}','{{1}}') then raise exception 'Template body mismatch'; end if;
    insert into private.followup_templates(step,name,language,approved) values(s.key,t->>'name',t->>'language',true)
      on conflict(step) do update set name=excluded.name,language=excluded.language,approved=true,verified_at=clock_timestamp();
  end loop;
end;
$$;

revoke all on function private.schedule_call_followups(text) from public,anon,authenticated;
revoke all on function public.register_webinar(uuid),public.record_cal_booking(jsonb),public.record_whatsapp_replies(jsonb),
  public.unsubscribe_webinar_email(uuid),public.read_followup_jobs(boolean,boolean),public.claim_followup_job(uuid,boolean,boolean),
  public.finish_followup_job(uuid,uuid,text,text,text),public.sync_followup_templates(jsonb) from public,anon,authenticated;
grant execute on function public.register_webinar(uuid),public.record_cal_booking(jsonb),public.record_whatsapp_replies(jsonb),
  public.unsubscribe_webinar_email(uuid),public.read_followup_jobs(boolean,boolean),public.claim_followup_job(uuid,boolean,boolean),
  public.finish_followup_job(uuid,uuid,text,text,text),public.sync_followup_templates(jsonb) to service_role;

-- Original supplied copy, with manual confirmation wording and numbered email steps.
insert into public.followup_steps(key,channel,scope,delay_seconds,parameter,subject,body)
  select key,channel,scope,delay_seconds,parameter,subject,body from jsonb_to_recordset($copy$[{"key":"booking_confirmation","channel":"whatsapp","scope":"booking","delay_seconds":0,"parameter":null,"body":"¡Hola! Vi que reservaste tu sesión 🙌🏻\nLa idea de la llamada es:\n\n- Entender bien tu caso y qué quieres mejorar.\n- Detectar tus principales puntos de mejora.\n- Valorar si realmente tiene sentido que trabajemos juntos.\n- Si encaja, explicarte cómo trabajamos y cuál sería el siguiente paso.\n\nSi vemos que podemos ayudarte de verdad, te explicaré cómo lo enfocaríamos contigo.\nTengo ganas de conocerte y analizar tu caso. Seguro que podemos sacar bastante en claro 😄"},{"key":"booking_24h","channel":"whatsapp","scope":"booking","delay_seconds":-86400,"parameter":"time","body":"Mañana tenemos nuestra sesión a las {{time}}.\nReserva unos 45 minutos y, si puedes, entra desde un sitio tranquilo.\nLa idea es que salgamos de la llamada con bastante claridad sobre qué deberías trabajar y cómo hacerlo.\nPara reservar ese espacio exclusivamente para ti, necesito que confirmes tu asistencia respondiendo “CONFIRMO” a este mensaje.\nSi no recibimos confirmación, revisaremos tu reserva antes de mantener la plaza."},{"key":"booking_2h","channel":"whatsapp","scope":"booking","delay_seconds":-7200,"parameter":"meetingUrl","body":"Nos vemos en un par de horas 👌\nSi aún no has confirmado tu asistencia, responde CONFIRMO para que podamos revisar tu reserva.\nTe dejo aquí el enlace para que lo tengas localizado:\n{{meetingUrl}}"},{"key":"booking_15m","channel":"whatsapp","scope":"booking","delay_seconds":-900,"parameter":null,"body":"En 15 minutos empezamos. Nos vemos ahora."},{"key":"webinar_1h","channel":"whatsapp","scope":"webinar","delay_seconds":3600,"parameter":"name","body":"Gracias por apuntarte a la clase {{name}}! ¿Pudiste verla entera? 👀\n\nAntes de dejarlo ahí, piensa en una cosa: ¿qué es lo que más estás buscando mejorar ahora mismo en tu comunicación?"},{"key":"webinar_1d","channel":"whatsapp","scope":"webinar","delay_seconds":86400,"parameter":null,"body":"Una de las cosas que más veo es gente que sabe perfectamente qué quiere decir, pero no consigue que su mensaje tenga el peso que debería. 🙌🏻\nSi quieres que analicemos dónde te está pasando a ti, puedes reservar aquí:\nhttps://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion"},{"key":"webinar_3d","channel":"whatsapp","scope":"webinar","delay_seconds":259200,"parameter":null,"body":"Cierro por aquí para no llenarte de mensajes.\nSi en algún momento decides que quieres trabajar seriamente tu comunicación, influencia o ventas, puedes reservar directamente desde el link que te pasé. Un abrazo! 🙌🏻"},{"key":"email_1","channel":"email","scope":"webinar","delay_seconds":1800,"parameter":null,"subject":"Quédate con esta idea de la masterclass que has visto.","body":"Te escribo para hablarte  del vídeo en el que te muestro el sistema que utilizo para mejorar cómo comunicas, influyes y haces avanzar conversaciones importantes en reuniones, negociaciones, ventas y muchas otras situaciones..\nSi ya lo viste, sabrás que al final te invito a agendar una llamada de consultoría. Puede que te preguntes: ¿qué pasa si agendo?\nLo primero que vas a ganar es CLARIDAD. Si ahora mismo sientes que sabes lo que quieres transmitir, pero no siempre consigues generar el impacto que buscas, esta llamada te ayudará a detectar dónde está el problema. En ella vemos:\nEn qué punto estás ahora mismo con tu comunicación.\nCómo estás proyectando autoridad, seguridad y confianza.\nQué ocurre en tus conversaciones de ventas, reuniones, negociaciones o presentaciones.\nQué deberías trabajar para comunicar con más criterio, adaptarte mejor y hacer avanzar esas conversaciones.\nSi vemos que podemos ayudarte, te invitaremos a nuestra mentoría; si no, también te lo diremos. Al ser una llamada de valor, no sabemos cuánto tiempo más la ofreceremos gratis.\nAgenda tu llamada aquí >> https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion\nUn abrazo,\nIgnacio Roa.\nPD. Las plazas son limitadas. Agenda ahora, antes de que se llenen."},{"key":"email_2","channel":"email","scope":"webinar","delay_seconds":86400,"parameter":null,"subject":"Te presento a Santiago, Maria y Mateo.","body":"¡Hola, {{name}}!\nEn la clase de esta semana te hablé de la importancia de cómo nos perciben los demás. Puedes tener una gran propuesta, dominar tu sector o saber perfectamente lo que quieres decir, pero si no consigues transmitir seguridad, autoridad y confianza, la conversación cambia por completo.\nPor eso quiero presentarte a algunas de las personas con las que he trabajado y los cambios que han conseguido.\n◉ Santiago. De explicar demasiado a cerrar reuniones con mucha más claridad.\n\nSantiago dirige una empresa de servicios y sentía que en las reuniones comerciales daba demasiada información y perdía el control de la conversación. Trabajamos cómo leer mejor las señales del cliente, reducir explicación y adaptar las preguntas según el momento. Empezó a conducir las reuniones con mucha más estructura y a llegar antes a la decisión real del cliente.\n\n\n◉ Maria. De ponerse nerviosa en presentaciones a transmitir seguridad y autoridad.\n\nMaría tenía experiencia y conocimiento, pero cuando tenía que presentar delante de clientes o dirección aceleraba, justificaba demasiado sus ideas y perdía presencia. Trabajamos especialmente ritmo, pausas, lenguaje no verbal y estructura del mensaje. El cambio principal fue que empezó a comunicar sus ideas con mucha más calma, claridad y credibilidad.\n\n◉ Mateo. De bloquearse ante las objeciones a saber conducirlas.\n\nÁlvaro trabaja en ventas y uno de sus principales problemas aparecía cuando el cliente decía “es caro” o “me lo tengo que pensar”. Su reacción era justificar inmediatamente la propuesta. Trabajamos cómo validar, explorar lo que había detrás de la objeción y adaptar la respuesta. Ahora utiliza esas objeciones para entender mejor al cliente y hacer avanzar la conversación en lugar de entrar a defenderse.\n\nEstos son solo algunos ejemplos.\nAgenda tu sesión aquí >> https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion\n y valoramos juntos cómo ayudarte.\nUn abrazo,\nIgnacio Roa.\nPD. Si ellos pudieron cambiar la forma en la que afrontan sus conversaciones importantes, tú también puedes. Agenda tu sesión aquí >> https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion"},{"key":"email_3","channel":"email","scope":"webinar","delay_seconds":172800,"parameter":null,"subject":"Esto es lo que me dice la mayoría de la gente:","body":"\"Ojalá hubiese empezado antes\"\n¿Sabes qué me decía a mí mismo cuando sabía que tenía que mejorar mi forma de comunicar?\n\"Ya lo iré trabajando\".\nQue si necesitaba más experiencia, que si con el tiempo ganaría seguridad, que si ya aprendería a vender mejor sobre la marcha...\nHasta que entendí algo: comunicar mejor no suele ocurrir solo por acumular más años.\n¿Y sabes qué aprendí? Que puedes tener conocimiento, experiencia e incluso una buena propuesta y seguir perdiendo oportunidades por cómo afrontas determinadas conversaciones.\nQue estés leyendo esto significa que probablemente ya has detectado que hay algo que quieres mejorar.\nDeja de esperar a que llegue solo: si quieres resultados distintos en tus conversaciones, tienes que empezar a comunicar de forma diferente.\nAgenda una llamada conmigo aquí y vemos juntos qué deberías trabajar >>\nhttps://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion\nSi puedo ayudarte, te explicaré cómo. Si no, también te lo diré con total claridad.\nUn abrazo,\nIgnacio Roa.\nPD. Si esto te ha resonado, no lo dejes para luego. Agenda tu llamada aquí >>\nhttps://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion"},{"key":"email_4","channel":"email","scope":"webinar","delay_seconds":259200,"parameter":null,"subject":"Transferencia recibida.","body":"Imagina recibir mensajes así todas las semanas.\n\nEsto es lo que ocurre cuando empiezas a comunicar con más autoridad, leer mejor a la persona que tienes delante y adaptar tu forma de comunicar, tal y como te enseñé en la clase online. Comunicar mejor puede cambiar mucho más que una conversación:\nCerrar más oportunidades sin tener que perseguir tanto.\nDefender mejor tu precio y reducir descuentos innecesarios.\nAcortar reuniones que antes se alargaban sin llegar a nada.\nDetectar antes cuándo una oportunidad es real y cuándo estás perdiendo el tiempo.\nNegociar mejor condiciones, acuerdos y decisiones importantes.\nAl final, comunicar mejor no solo mejora cómo te perciben.\nTambién puede ayudarte a ganar más, perder menos tiempo y tomar mejores decisiones en conversaciones que tienen impacto directo en tu trabajo o negocio.\nSi tienes dudas, agenda una llamada de claridad conmigo: 35 minutos para responder tus dudas. Elige un hueco en mi calendario aquí >> https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion\nUn saludo,\nIgnacio Roa.\nPD. Cuanto antes agendes, antes puedes empezar a mejorar las conversaciones que más impacto tienen en tus resultados. Elige tu hueco aquí >> https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion"}]$copy$::jsonb)
  as t(key text,channel text,scope text,delay_seconds integer,parameter text,subject text,body text);
