create table private.funnel_events (
  session_id uuid not null,
  event text not null check (event in (
    'visit','video_play','video_25','video_50','video_75','video_complete','booking_open','contact_saved',
    'question_1','question_2','question_3','question_4','question_5','question_6','question_7',
    'form_completed','calendar_open')),
  created_at timestamptz not null default now(),
  primary key (session_id, event)
);
create index funnel_events_created_at on private.funnel_events(created_at);
alter table private.funnel_events enable row level security;

create function public.record_funnel_event(p_session_id uuid, p_event text)
returns void language sql security definer set search_path = '' as $$
  insert into private.funnel_events(session_id, event) values (p_session_id, p_event)
  on conflict do nothing;
$$;
revoke all on function public.record_funnel_event(uuid, text) from public, anon, authenticated;
grant execute on function public.record_funnel_event(uuid, text) to service_role;

create function public.get_funnel_metrics(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_start is null or p_end is null or p_end <= p_start or p_end - p_start > 366 then
    raise exception 'Choose a positive date range of at most 366 days';
  end if;
  return coalesce((select jsonb_object_agg(event, sessions) from (
    select event, count(*) as sessions from private.funnel_events
    where created_at >= p_start::timestamp at time zone 'Europe/Madrid'
      and created_at < p_end::timestamp at time zone 'Europe/Madrid'
    group by event) counts), '{}'::jsonb);
end;
$$;
revoke all on function public.get_funnel_metrics(date, date) from public, anon, authenticated;
grant execute on function public.get_funnel_metrics(date, date) to service_role;

alter table public.leads
  add column qualification_step smallint check (qualification_step between 1 and 7),
  add column qualification_draft jsonb,
  add column qualification_progress_at timestamptz;

create function public.save_masterclass_progress(p_submission_id uuid, p_step integer, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads;
begin
  if p_submission_id is null or p_step is null or p_step not between 1 and 7
    or p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Invalid progress';
  end if;
  update public.leads set qualification_step = greatest(coalesce(qualification_step, 0), p_step),
    qualification_draft = coalesce(qualification_draft, '{}'::jsonb) || p_answers, qualification_progress_at = clock_timestamp()
  where idempotency_key = p_submission_id and qualified_at is null
  returning * into l;
  if found then return jsonb_build_object('outcome', 'saved'); end if;
  if exists(select 1 from public.leads where idempotency_key = p_submission_id) then
    return jsonb_build_object('outcome', 'completed');
  end if;
  return jsonb_build_object('outcome', 'missing');
end;
$$;
revoke all on function public.save_masterclass_progress(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_masterclass_progress(uuid, integer, jsonb) to service_role;
