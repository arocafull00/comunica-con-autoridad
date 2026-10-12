-- Restore the original schedule for new webinar registrations.
-- Existing jobs keep their dates, retry state and delivery history.
-- The isolated WhatsApp sandbox keeps its own accelerated test schedule.
update public.followup_steps as s
set delay_seconds = timings.delay_seconds
from (values
  ('webinar_1h', 3600),
  ('webinar_1d', 86400),
  ('webinar_3d', 259200),
  ('email_1', 1800),
  ('email_2', 86400),
  ('email_3', 172800),
  ('email_4', 259200)
) as timings(key, delay_seconds)
where s.key = timings.key and s.scope = 'webinar';
