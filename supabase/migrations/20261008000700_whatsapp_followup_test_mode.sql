-- Sandbox jobs use the real queue but remain permanently isolated from paid delivery.
create table private.whatsapp_followup_test (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  phone text not null check(phone ~ '^\+[1-9][0-9]{6,14}$')
);
revoke all on private.whatsapp_followup_test from public,anon,authenticated,service_role;
alter table public.followup_jobs add column test_mode boolean not null default false;

create function public.configure_whatsapp_followup_test(p_phone text,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(8,0);
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$' or p_enabled is null then raise exception 'Invalid test configuration'; end if;
  insert into private.whatsapp_followup_test(singleton,phone,enabled) values(true,p_phone,p_enabled)
    on conflict(singleton) do update set phone=excluded.phone,enabled=excluded.enabled;
end;
$$;

create function private.mark_whatsapp_test_job() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.followup_steps; r public.webinar_registrations;
begin
  select * into s from public.followup_steps where key=new.step;
  select * into r from public.webinar_registrations where id=new.registration_id;
  if s.channel='whatsapp' and exists(select 1 from private.whatsapp_followup_test c join public.leads l on l.id=r.lead_id where c.enabled and c.phone=l.phone) then
    new.test_mode:=true;
    if s.scope='webinar' then
      new.scheduled_at:=r.registered_at+make_interval(secs=>case new.step when 'webinar_1h' then 60 when 'webinar_1d' then 180 else 300 end);
      new.expires_at:=new.scheduled_at+interval '6 hours';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.mark_whatsapp_test_job() from public,anon,authenticated,service_role;
create trigger mark_whatsapp_test_job before insert on public.followup_jobs for each row execute function private.mark_whatsapp_test_job();

create function public.read_whatsapp_test_jobs(p_phone text) returns table(id uuid)
language sql security definer set search_path='' as $$
  select j.id from public.followup_jobs j join public.webinar_registrations r on r.id=j.registration_id
    join public.leads l on l.id=r.lead_id join private.whatsapp_followup_test c on c.phone=l.phone and c.enabled
    where j.test_mode and c.phone=p_phone and ((j.status='processing' and j.processing_started_at<clock_timestamp()-interval '120 seconds')
      or (j.status='pending' and j.scheduled_at<=clock_timestamp()))
    order by (j.status='processing') desc,j.scheduled_at limit 10;
$$;

create function public.claim_whatsapp_test_job(p_job_id uuid,p_phone text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(8,0);
  if not exists(select 1 from public.followup_jobs j join public.webinar_registrations r on r.id=j.registration_id
    join public.leads l on l.id=r.lead_id join private.whatsapp_followup_test c on c.phone=l.phone and c.enabled
    join public.followup_steps s on s.key=j.step
    where j.id=p_job_id and j.test_mode and s.channel='whatsapp' and c.phone=p_phone) then return jsonb_build_object('action','paused'); end if;
  return private.claim_followup_job_base(p_job_id,false,true);
end;
$$;

create or replace function public.claim_followup_job(p_job_id uuid,p_email boolean,p_whatsapp boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform pg_advisory_xact_lock(8,0);
  if exists(select 1 from public.followup_jobs where id=p_job_id and test_mode) then return jsonb_build_object('action','paused'); end if;
  v_result:=private.claim_followup_job_base(p_job_id,p_email,p_whatsapp);
  if v_result->>'action'='missing_template' then update public.followup_jobs set last_error='missing_template' where id=p_job_id and status='pending'; end if;
  return v_result;
end;
$$;

create function public.whatsapp_test_job_status(p_phone text) returns table(id uuid,registration_id uuid,step text,booking_uid text,scheduled_at timestamptz,status text,last_error text,sent_at timestamptz)
language sql security definer set search_path='' as $$
  select j.id,j.registration_id,j.step,j.booking_uid,j.scheduled_at,j.status,j.last_error,j.sent_at
    from public.followup_jobs j join public.webinar_registrations r on r.id=j.registration_id join public.leads l on l.id=r.lead_id
    join private.whatsapp_followup_test c on c.phone=l.phone
    where j.test_mode and c.phone=p_phone order by r.registered_at desc,j.scheduled_at limit 100;
$$;

create function public.advance_whatsapp_test_job(p_phone text,p_job_id uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare j public.followup_jobs; v_now timestamptz:=clock_timestamp(); v_end timestamptz;
begin
  perform pg_advisory_xact_lock(8,0);
  select q.* into j from public.followup_jobs q join public.webinar_registrations r on r.id=q.registration_id join public.leads l on l.id=r.lead_id
    join private.whatsapp_followup_test c on c.phone=l.phone and c.enabled
    where q.id=p_job_id and q.test_mode and q.status='pending' and q.attempts=0 and c.phone=p_phone for update of q;
  if not found then raise exception 'Pending test job required'; end if;
  v_end:=v_now+interval '6 hours';
  if j.booking_uid is not null then select least(v_end,start_time) into v_end from public.call_bookings where uid=j.booking_uid and status='booked' and revision=j.booking_revision; end if;
  if v_end is null or v_end<=v_now+interval '60 seconds' then raise exception 'Booking changed or too close'; end if;
  update public.followup_jobs set scheduled_at=v_now+interval '60 seconds',expires_at=v_end where id=j.id;
  return v_now+interval '60 seconds';
end;
$$;

revoke all on function public.configure_whatsapp_followup_test(text,boolean),public.read_whatsapp_test_jobs(text),public.claim_whatsapp_test_job(uuid,text),public.whatsapp_test_job_status(text),public.advance_whatsapp_test_job(text,uuid) from public,anon,authenticated;
grant execute on function public.configure_whatsapp_followup_test(text,boolean),public.read_whatsapp_test_jobs(text),public.claim_whatsapp_test_job(uuid,text),public.whatsapp_test_job_status(text),public.advance_whatsapp_test_job(text,uuid) to service_role;

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
  if j.test_mode and not exists(select 1 from private.whatsapp_followup_test c join public.webinar_registrations r on r.id=j.registration_id join public.leads l on l.id=r.lead_id where c.enabled and c.phone=l.phone) then return jsonb_build_object('action','paused'); end if;
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

create or replace function public.read_followup_jobs(p_email boolean,p_whatsapp boolean) returns table(id uuid)
language sql security definer set search_path = '' as $$
  select j.id from public.followup_jobs j join public.followup_steps s on s.key=j.step
    where not j.test_mode and ((s.channel='email' and p_email) or
      (s.channel='whatsapp' and p_whatsapp and (select enabled from public.whatsapp_settings where singleton)))
      and ((j.status='processing' and j.processing_started_at<clock_timestamp()-interval '120 seconds') or
        (j.status='pending' and j.scheduled_at<=clock_timestamp() and (
          j.expires_at<=clock_timestamp() or (
            (j.last_error is distinct from 'missing_template' or exists(
              select 1 from private.followup_templates t where t.step=j.step and t.approved
                and coalesce(j.payload->>'templateName',t.name)=t.name
                and coalesce(j.payload->>'templateLanguage',t.language)=t.language))
            and (j.last_error is distinct from 'missing_meeting_url' or exists(
              select 1 from public.call_bookings b where b.uid=j.booking_uid and b.meeting_url is not null))
          ))))
    order by (j.status='processing') desc,j.scheduled_at limit 10;
$$;
