-- Email grants access; name and mobile arrive with qualification.
-- Existing leads, consent evidence and delivery history are untouched.
alter table public.leads alter column phone drop not null;

create function public.submit_masterclass_email_access(
  p_idempotency_key uuid,p_email text,p_communications_consent boolean,
  p_consent_version text,p_ip_hash text,p_utm_source text default null,
  p_utm_medium text default null,p_utm_campaign text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; v_count integer; v_oldest timestamptz; v_now timestamptz:=clock_timestamp();
begin
  if p_idempotency_key is null or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_communications_consent is null then raise exception 'Invalid submission metadata'; end if;
  p_email:=lower(btrim(p_email));
  if p_email is null or char_length(p_email) not between 3 and 254 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or (p_communications_consent and nullif(btrim(p_consent_version),'') is null) then
    raise exception 'Invalid email access';
  end if;
  perform pg_advisory_xact_lock(1,hashtext(p_idempotency_key::text));
  select * into l from public.leads where idempotency_key=p_idempotency_key;
  if found then
    if (l.email,l.communications_consent,l.utm_source,l.utm_medium,l.utm_campaign)
      is distinct from (p_email,p_communications_consent,nullif(btrim(p_utm_source),''),
        nullif(btrim(p_utm_medium),''),nullif(btrim(p_utm_campaign),'')) then
      return jsonb_build_object('outcome','conflict');
    end if;
    return jsonb_build_object('outcome','replayed','lead',private.masterclass_sheet_lead(l));
  end if;
  perform pg_advisory_xact_lock(2,hashtext(p_ip_hash));
  select count(*),min(created_at) into v_count,v_oldest from private.lead_request_log
    where ip_hash=p_ip_hash and created_at>v_now-interval '10 minutes';
  if v_count>=5 then
    return jsonb_build_object('outcome','rate_limited','retry_after',
      greatest(1,ceil(extract(epoch from v_oldest+interval '10 minutes'-v_now))::integer));
  end if;
  insert into private.lead_request_log(ip_hash) values(p_ip_hash);
  insert into public.leads(idempotency_key,email,communications_consent,
    communications_consent_at,communications_consent_version,utm_source,utm_medium,utm_campaign)
  values(p_idempotency_key,p_email,p_communications_consent,
    case when p_communications_consent then v_now end,
    case when p_communications_consent then p_consent_version end,
    nullif(btrim(p_utm_source),''),nullif(btrim(p_utm_medium),''),nullif(btrim(p_utm_campaign),''))
  returning * into l;
  return jsonb_build_object('outcome','created','lead',private.masterclass_sheet_lead(l));
end;
$$;
revoke all on function public.submit_masterclass_email_access(uuid,text,boolean,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_masterclass_email_access(uuid,text,boolean,text,text,text,text,text) to service_role;

-- Bookings received before a mobile is supplied wait for the contact step.
create or replace function private.schedule_call_followups(p_uid text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.call_bookings; l public.leads; v_now timestamptz:=clock_timestamp(); v_short boolean; v_under_two boolean;
begin
  select * into b from public.call_bookings where uid=p_uid;
  if not found or b.status<>'booked' or b.registration_id is null or b.start_time<=v_now then return; end if;
  select lead.* into l from public.leads lead join public.webinar_registrations r on r.lead_id=lead.id
    where r.id=b.registration_id;
  if l.phone is null or not l.whatsapp_consent then return; end if;
  v_short:=b.start_time<b.last_event_at+interval '24 hours';
  v_under_two:=b.start_time<b.last_event_at+interval '2 hours';
  insert into public.followup_jobs(registration_id,step,booking_uid,booking_revision,scheduled_at,expires_at,status,last_error)
    select b.registration_id,s.key,b.uid,b.revision,s.due_at,
      case when s.key in ('booking_confirmation','booking_short_notice') then b.start_time
        else least(b.start_time,s.due_at+interval '30 minutes') end,
      case when s.reason is null then 'pending' else 'suppressed' end,s.reason
    from (
      select f.key,
        case when f.key in ('booking_confirmation','booking_short_notice') then v_now else b.start_time+make_interval(secs=>f.delay_seconds) end as due_at,
        case
          when v_under_two and f.key<>'booking_15m' then 'not_needed_short_notice'
          when f.key='booking_confirmation' and v_short then 'not_needed_variant'
          when f.key='booking_short_notice' and not v_short then 'not_needed_variant'
          when f.key not in ('booking_confirmation','booking_short_notice') and b.start_time+make_interval(secs=>f.delay_seconds)<=v_now then 'reminder_time_elapsed'
          else null end as reason
      from public.followup_steps f where f.scope='booking'
    ) s
    on conflict do nothing;
end;
$$;

create function public.complete_masterclass_qualification_with_contact(
  p_submission_id uuid,p_name text,p_phone text,p_whatsapp_consent_version text,
  p_profession text,p_goal text,p_commitment text,p_investment text,
  p_application_reasons text,p_admission_decision text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; r public.webinar_registrations; b public.call_bookings;
  v_result jsonb; v_now timestamptz:=clock_timestamp(); v_new_contact boolean;
begin
  if p_submission_id is null then return jsonb_build_object('outcome','missing'); end if;
  p_name:=nullif(btrim(p_name),'');
  if p_name is null or char_length(p_name) not between 2 and 100 or p_name ~ E'[\r\n\t]'
    or p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$'
    or nullif(btrim(p_whatsapp_consent_version),'') is null then raise exception 'Invalid contact'; end if;
  perform pg_advisory_xact_lock(8,0);
  perform pg_advisory_xact_lock(1,hashtext(p_submission_id::text));
  select * into l from public.leads where idempotency_key=p_submission_id for update;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  select * into r from public.webinar_registrations where lead_id=l.id;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  v_new_contact:=l.phone is null;
  if not v_new_contact and (l.name,l.phone) is distinct from (p_name,p_phone) then
    return jsonb_build_object('outcome','conflict');
  end if;
  if v_new_contact then
    update public.leads set name=p_name,phone=p_phone,whatsapp_consent=true,
      whatsapp_consent_at=v_now,whatsapp_consent_version=p_whatsapp_consent_version
      where id=l.id;
  end if;
  v_result:=public.complete_masterclass_qualification(p_submission_id,p_profession,p_goal,
    p_commitment,p_investment,p_application_reasons,p_admission_decision);
  if v_result->>'outcome' not in ('created','replayed') then return v_result; end if;
  if v_new_contact then
    -- The WhatsApp sequence starts when the visitor submits their mobile.
    insert into public.followup_jobs(registration_id,step,scheduled_at,expires_at)
      select r.id,s.key,v_now+make_interval(secs=>s.delay_seconds),
        v_now+make_interval(secs=>s.delay_seconds)+interval '6 hours'
      from public.followup_steps s where s.scope='webinar' and s.channel='whatsapp'
      on conflict do nothing;
    update public.followup_jobs set status='suppressed',last_error='call_already_booked'
      where registration_id=r.id and step in ('webinar_1h','webinar_1d','webinar_3d')
        and status='pending' and exists(select 1 from public.call_bookings where registration_id=r.id);
    for b in select * from public.call_bookings where registration_id=r.id and status='booked' loop
      perform private.schedule_call_followups(b.uid);
    end loop;
  end if;
  select * into l from public.leads where id=l.id;
  return v_result || jsonb_build_object('lead',private.masterclass_sheet_lead(l));
end;
$$;
revoke all on function public.complete_masterclass_qualification_with_contact(uuid,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_masterclass_qualification_with_contact(uuid,text,text,text,text,text,text,text,text,text) to service_role;
