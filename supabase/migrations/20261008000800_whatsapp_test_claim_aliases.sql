-- Distinguish test-row aliases from the claim function row variables.
create or replace function private.claim_followup_job_base(p_job_id uuid,p_email boolean,p_whatsapp boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.followup_jobs; s public.followup_steps; r public.webinar_registrations;
  l public.leads; b public.call_bookings; t private.followup_templates;
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
    'subject',s.subject,'body',s.body,'parameter',case when j.test_mode then null else s.parameter end,
    'templateName',case when j.test_mode then 'hello_world' else t.name end,
    'templateLanguage',case when j.test_mode then 'en_US' else t.language end,'testMode',j.test_mode));
  update public.followup_jobs set status='processing',attempts=attempts+1,claim_token=v_token,
    processing_started_at=v_now,payload=v_payload where id=j.id;
  update private.followup_slots set job_id=j.id,token=v_token,leased_until=v_now+interval '120 seconds' where slot=v_slot;
  return jsonb_build_object('action','claimed','claimToken',v_token,'message',v_payload);
end;
$$;
