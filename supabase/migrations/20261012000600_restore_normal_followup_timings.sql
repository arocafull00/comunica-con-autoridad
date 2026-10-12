-- End the temporary minute-based production test. Preserve delivery history,
-- attempted payloads and the separate, recipient-specific sandbox schedule.
select pg_advisory_xact_lock(8,0);

with timings as (
  select s.key,s.delay_seconds as previous_seconds,t.seconds
  from public.followup_steps s join (values
    ('webinar_1h',3600),('webinar_1d',86400),('webinar_3d',259200),
    ('email_1',1800),('email_2',86400),('email_3',172800),('email_4',259200),
    ('booking_24h',-86400),('booking_2h',-7200),('booking_15m',-900)
  ) as t(key,seconds) on s.key=t.key
), restored as (
  update public.followup_steps s set delay_seconds=t.seconds from timings t
  where s.key=t.key returning s.key,s.scope,t.seconds-t.previous_seconds as adjustment
)
update public.followup_jobs j
set scheduled_at=j.scheduled_at+make_interval(secs=>r.adjustment),
    expires_at=j.expires_at+make_interval(secs=>r.adjustment)
from restored r
where r.key=j.step and r.scope='webinar' and not j.test_mode
  and j.status='pending' and j.attempts=0;

-- The scheduler already derives short-notice thresholds from followup_steps:
-- restoring offsets also restores its 24-hour / 2-hour booking branches.
update public.followup_jobs j
set scheduled_at=b.start_time+make_interval(secs=>s.delay_seconds),
    expires_at=least(b.start_time,b.start_time+make_interval(secs=>s.delay_seconds)+interval '30 minutes'),
    status=case when b.start_time+make_interval(secs=>s.delay_seconds)>now() then 'pending' else 'suppressed' end,
    last_error=case when b.start_time+make_interval(secs=>s.delay_seconds)>now() then null else 'reminder_time_elapsed' end
from public.followup_steps s,public.call_bookings b
where s.key=j.step and s.key in ('booking_24h','booking_2h','booking_15m')
  and b.uid=j.booking_uid and b.revision=j.booking_revision and b.status='booked'
  and not j.test_mode and j.status='pending' and j.attempts=0;
