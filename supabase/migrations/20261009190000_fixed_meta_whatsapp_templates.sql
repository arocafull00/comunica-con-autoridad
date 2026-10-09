-- Fixed provider identities. Meta owns the text, language and component definitions.
-- Does not activate delivery or requeue existing jobs.
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

-- No manually configurable trigger mappings remain.
drop function public.sync_followup_templates(jsonb);

drop function public.read_whatsapp_automation_catalog();
create function public.read_whatsapp_automation_catalog() returns table(
  key text,body text,parameter text,template_name text,language text,meta_status text,ready boolean,components jsonb)
language sql security definer set search_path = '' as $$
  select s.key,coalesce(w.body,''),s.parameter,t.name,t.language,w.meta_status,
    coalesce(w.meta_status='APPROVED',false),coalesce(w.components,'[]'::jsonb)
    from public.followup_steps s left join private.followup_templates t on t.step=s.key
    left join public.whatsapp_templates w on w.name=t.name and w.language=t.language
    where s.channel='whatsapp';
$$;
revoke all on function public.read_whatsapp_automation_catalog() from public,anon,authenticated;
grant execute on function public.read_whatsapp_automation_catalog() to service_role;

-- Keep the existing consent, expiry, booking, lease and ambiguous-result checks.
-- A changed local copy does not prevent sending a provider-approved template.
create or replace function public.claim_followup_job(p_job_id uuid,p_email boolean,p_whatsapp boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return private.claim_fixed_followup_job_base(p_job_id,p_email,p_whatsapp);
end;
$$;
revoke all on function public.claim_followup_job(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_followup_job(uuid,boolean,boolean) to service_role;

select private.refresh_fixed_whatsapp_templates();

-- Distinguish test-row aliases from the claim function row variables.
create or replace function private.claim_followup_job_base(p_job_id uuid,p_email boolean,p_whatsapp boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.followup_jobs; s public.followup_steps; r public.webinar_registrations;
  l public.leads; b public.call_bookings; t private.followup_templates; w public.whatsapp_templates;
  v_reason text; v_now timestamptz:=clock_timestamp(); v_slot integer; v_token uuid:=gen_random_uuid();
  v_time text; v_payload jsonb;
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
  if s.channel='whatsapp' and not j.test_mode then
    if not (select enabled from public.whatsapp_settings where singleton) then return jsonb_build_object('action','paused'); end if;
    select f.* into t from private.followup_templates f join public.whatsapp_templates c on c.name=f.name and c.language=f.language where f.step=s.key and f.approved and c.meta_status='APPROVED';
    if not found then
      update public.followup_jobs set last_error='missing_template' where id=j.id;
      return jsonb_build_object('action','missing_template');
    end if;
    if j.payload is not null and (j.payload->>'templateName',j.payload->>'templateLanguage') is distinct from (t.name,t.language) then
      return jsonb_build_object('action','missing_template');
    end if;
  end if;
  if s.channel='whatsapp' and not j.test_mode then select * into w from public.whatsapp_templates where name=t.name and language=t.language; end if;
  select slot into v_slot from private.followup_slots where leased_until is null or leased_until<=v_now order by slot limit 1 for update skip locked;
  if not found then return jsonb_build_object('action','busy'); end if;
  v_time:=case when b.uid is not null then to_char(b.start_time at time zone b.time_zone,'HH24:MI')||' ('||b.time_zone||')' else '' end;
  v_payload:=coalesce(j.payload,jsonb_build_object('id',j.id,'registrationId',r.id,'channel',s.channel,'step',s.key,
    'email',r.email,'phone',l.phone,'name',l.name,'time',v_time,'meetingUrl',b.meeting_url,
    'subject',s.subject,'body',coalesce(w.body,s.body),'templateComponents',w.components,'parameter',case when j.test_mode then null else s.parameter end,
    'templateName',case when j.test_mode then 'hello_world' else t.name end,
    'templateLanguage',case when j.test_mode then 'en_US' else t.language end,'testMode',j.test_mode));
  update public.followup_jobs set status='processing',attempts=attempts+1,claim_token=v_token,
    processing_started_at=v_now,payload=v_payload where id=j.id;
  update private.followup_slots set job_id=j.id,token=v_token,leased_until=v_now+interval '120 seconds' where slot=v_slot;
  return jsonb_build_object('action','claimed','claimToken',v_token,'message',v_payload);
end;
$$;
