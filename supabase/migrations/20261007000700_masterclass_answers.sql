-- Preserve all six answers from the masterclass form; existing leads remain valid.
alter table public.leads
  add column profession text check (char_length(profession) between 1 and 200),
  add column situation text check (char_length(situation) between 1 and 300),
  add column goal text check (char_length(goal) between 1 and 300),
  add constraint masterclass_answers_complete check (
    (profession is null and situation is null and goal is null) or
    (profession is not null and situation is not null and goal is not null)
  );

-- Drop the old signature to avoid ambiguous RPC overloads. Defaults preserve old clients.
drop function public.submit_lead(uuid, text, text, text, boolean, text, text, text, text, text);
create function public.submit_lead(
  p_idempotency_key uuid, p_name text, p_phone text, p_email text,
  p_whatsapp_consent boolean, p_consent_version text, p_ip_hash text,
  p_utm_source text default null, p_utm_medium text default null, p_utm_campaign text default null,
  p_profession text default null, p_situation text default null, p_goal text default null
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
  p_profession := nullif(btrim(p_profession), '');
  p_situation := nullif(btrim(p_situation), '');
  p_goal := nullif(btrim(p_goal), '');
  perform pg_advisory_xact_lock(1, hashtext(p_idempotency_key::text));
  select * into v_existing from public.leads where idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.name, v_existing.phone, v_existing.email, v_existing.whatsapp_consent,
        v_existing.utm_source, v_existing.utm_medium, v_existing.utm_campaign,
        v_existing.profession, v_existing.situation, v_existing.goal)
       is distinct from (p_name, p_phone, p_email, p_whatsapp_consent, p_utm_source, p_utm_medium, p_utm_campaign,
        p_profession, p_situation, p_goal) then
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
    whatsapp_consent_at, whatsapp_consent_version, utm_source, utm_medium, utm_campaign, profession, situation, goal)
  values (p_idempotency_key, p_name, p_phone, p_email, p_whatsapp_consent,
    case when p_whatsapp_consent then v_now end,
    case when p_whatsapp_consent then p_consent_version end, p_utm_source, p_utm_medium, p_utm_campaign, p_profession, p_situation, p_goal);
  return jsonb_build_object('outcome', 'created');
end;
$$;
revoke all on function public.submit_lead(uuid, text, text, text, boolean, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_lead(uuid, text, text, text, boolean, text, text, text, text, text, text, text, text) to service_role;
