-- Schedule new webinar registrations in minutes, measured from registered_at.
-- Existing jobs keep their dates, retry state and delivery history.
update public.followup_steps as s
set delay_seconds = timings.delay_seconds
from (values
  ('webinar_1h', 60),
  ('webinar_1d', 180),
  ('webinar_3d', 300),
  ('email_1', 60),
  ('email_2', 180),
  ('email_3', 300),
  ('email_4', 420)
) as timings(key, delay_seconds)
where s.key = timings.key and s.scope = 'webinar';
