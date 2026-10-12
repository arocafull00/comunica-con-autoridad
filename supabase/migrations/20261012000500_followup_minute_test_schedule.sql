-- Temporary production test timings. Original step keys and approved copy stay fixed.
-- Restore normal delays in a new migration after testing; do not edit this migration.
select pg_advisory_xact_lock(8,0);

update public.followup_steps s set delay_seconds=t.seconds
from (values
  ('webinar_1h',60),('webinar_1d',180),('webinar_3d',300),
  ('email_1',60),('email_2',120),('email_3',240),('email_4',360),
  ('booking_24h',-300),('booking_2h',-180),('booking_15m',-60)
) as t(key,seconds) where s.key=t.key;

-- Keep short-notice selection aligned with the configured reminder offsets.
create or replace function private.schedule_call_followups(p_uid text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.call_bookings; l public.leads; v_now timestamptz:=clock_timestamp(); v_short boolean; v_under_two boolean;
begin
  select * into b from public.call_bookings where uid=p_uid;
  if not found or b.status<>'booked' or b.registration_id is null or b.start_time<=v_now then return; end if;
  select lead.* into l from public.leads lead join public.webinar_registrations r on r.lead_id=lead.id
    where r.id=b.registration_id;
  if l.phone is null or not l.whatsapp_consent then return; end if;
  v_short:=b.start_time<b.last_event_at-make_interval(secs=>(select delay_seconds from public.followup_steps where key='booking_24h'));
  v_under_two:=b.start_time<b.last_event_at-make_interval(secs=>(select delay_seconds from public.followup_steps where key='booking_2h'));
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

-- Space any untouched pending webinar sequence from deployment time.
-- Never resend completed/suppressed jobs or change an attempted provider payload.
update public.followup_jobs j
set scheduled_at=now()+make_interval(secs=>s.delay_seconds),
    expires_at=now()+make_interval(secs=>s.delay_seconds)+interval '6 hours'
from public.followup_steps s
where s.key=j.step and s.scope='webinar' and j.status='pending' and j.attempts=0;

update public.followup_jobs j
set scheduled_at=b.start_time+make_interval(secs=>s.delay_seconds),
    expires_at=least(b.start_time,b.start_time+make_interval(secs=>s.delay_seconds)+interval '30 minutes'),
    status=case when b.start_time+make_interval(secs=>s.delay_seconds)>now() then 'pending' else 'suppressed' end,
    last_error=case when b.start_time+make_interval(secs=>s.delay_seconds)>now() then null else 'reminder_time_elapsed' end
from public.followup_steps s,public.call_bookings b
where s.key=j.step and s.key in ('booking_24h','booking_2h','booking_15m')
  and b.uid=j.booking_uid and b.revision=j.booking_revision and b.status='booked'
  and j.status='pending' and j.attempts=0;
