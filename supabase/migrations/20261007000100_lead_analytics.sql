-- Campaign attribution remains in protected lead records, never in analytics events.
alter table public.leads
  add column utm_source text check (char_length(utm_source) <= 100),
  add column utm_medium text check (char_length(utm_medium) <= 100),
  add column utm_campaign text check (char_length(utm_campaign) <= 100);
create index leads_created_at on public.leads(created_at);

-- Drop the old signature to avoid ambiguous RPC overloads. Defaults preserve old clients.
drop function public.submit_lead(uuid, text, text, text, boolean, text, text);
create function public.submit_lead(
  p_idempotency_key uuid, p_name text, p_phone text, p_email text,
  p_whatsapp_consent boolean, p_consent_version text, p_ip_hash text,
  p_utm_source text default null, p_utm_medium text default null, p_utm_campaign text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.leads;
  v_count integer;
  v_oldest timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_idempotency_key is null or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid submission metadata';
  end if;
  p_utm_source := nullif(btrim(p_utm_source), '');
  p_utm_medium := nullif(btrim(p_utm_medium), '');
  p_utm_campaign := nullif(btrim(p_utm_campaign), '');
  perform pg_advisory_xact_lock(1, hashtext(p_idempotency_key::text));
  select * into v_existing from public.leads where idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.name, v_existing.phone, v_existing.email, v_existing.whatsapp_consent,
        v_existing.utm_source, v_existing.utm_medium, v_existing.utm_campaign)
       is distinct from (p_name, p_phone, p_email, p_whatsapp_consent, p_utm_source, p_utm_medium, p_utm_campaign) then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    return jsonb_build_object('outcome', 'replayed');
  end if;
  perform pg_advisory_xact_lock(2, hashtext(p_ip_hash));
  select count(*), min(created_at) into v_count, v_oldest from private.lead_request_log
    where ip_hash = p_ip_hash and created_at > v_now - interval '10 minutes';
  if v_count >= 5 then
    return jsonb_build_object('outcome', 'rate_limited', 'retry_after',
      greatest(1, ceil(extract(epoch from v_oldest + interval '10 minutes' - v_now))::integer));
  end if;
  insert into private.lead_request_log(ip_hash) values (p_ip_hash);
  insert into public.leads(idempotency_key, name, phone, email, whatsapp_consent,
    whatsapp_consent_at, whatsapp_consent_version, utm_source, utm_medium, utm_campaign)
  values (p_idempotency_key, p_name, p_phone, p_email, p_whatsapp_consent,
    case when p_whatsapp_consent then v_now end,
    case when p_whatsapp_consent then p_consent_version end, p_utm_source, p_utm_medium, p_utm_campaign);
  return jsonb_build_object('outcome', 'created');
end;
$$;
revoke all on function public.submit_lead(uuid, text, text, text, boolean, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_lead(uuid, text, text, text, boolean, text, text, text, text, text) to service_role;

-- Administrative reporting: start inclusive, end exclusive, calendar days in Madrid.
create function public.get_lead_metrics(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_start is null or p_end is null or p_end <= p_start or p_end - p_start > 366 then
    raise exception 'Choose a positive date range of at most 366 days';
  end if;
  with filtered as materialized (
    select lower(btrim(email)) as email, whatsapp_consent, utm_source, utm_medium, utm_campaign,
      (created_at at time zone 'Europe/Madrid')::date as day
    from public.leads
    where source = 'web'
      and created_at >= p_start::timestamp at time zone 'Europe/Madrid'
      and created_at < p_end::timestamp at time zone 'Europe/Madrid'
  ), daily as (
    select day, count(*) as leads, count(distinct email) as unique_emails,
      count(*) filter (where whatsapp_consent) as whatsapp_consents
    from filtered group by day
  ), campaigns as (
    select utm_source, utm_medium, utm_campaign, count(*) as leads, count(distinct email) as unique_emails
    from filtered group by utm_source, utm_medium, utm_campaign
  )
  select jsonb_build_object(
    'start', p_start, 'end_exclusive', p_end, 'timezone', 'Europe/Madrid',
    'leads', (select count(*) from filtered),
    'unique_emails', (select count(distinct email) from filtered),
    'whatsapp_consents', (select count(*) from filtered where whatsapp_consent),
    'daily', coalesce((select jsonb_agg(to_jsonb(daily) order by day) from daily), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(to_jsonb(campaigns) order by leads desc, utm_source, utm_medium, utm_campaign) from campaigns), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_lead_metrics(date, date) from public, anon, authenticated;
grant execute on function public.get_lead_metrics(date, date) to service_role;
