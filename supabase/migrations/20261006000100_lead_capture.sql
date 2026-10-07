create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create extension if not exists pgmq;
revoke all on schema pgmq from public, anon, authenticated;
select pgmq.create('whatsapp_outbound');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid unique,
  name text not null check (char_length(name) between 2 and 100 and name !~ E'[\r\n\t]'),
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email text not null check (char_length(email) between 3 and 254),
  whatsapp_consent boolean not null default false,
  whatsapp_consent_at timestamptz,
  whatsapp_consent_version text,
  source text not null default 'web',
  created_at timestamptz not null default now(),
  constraint consent_evidence check (not whatsapp_consent or
    (whatsapp_consent_at is not null and nullif(whatsapp_consent_version, '') is not null))
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  template_name text,
  template_language text,
  graph_api_version text,
  sequence integer not null default 1 check (sequence = 1),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  provider_message_id text,
  last_error text,
  scheduled_at timestamptz not null default now(),
  processing_started_at timestamptz,
  claim_token uuid,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lead_id, sequence)
);
create index whatsapp_messages_status_schedule on public.whatsapp_messages(status, scheduled_at);

create table private.lead_request_log (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index lead_request_log_ip_time on private.lead_request_log(ip_hash, created_at);

alter table public.leads enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table private.lead_request_log enable row level security;
revoke all on public.leads, public.whatsapp_messages from public, anon, authenticated;
grant all on public.leads, public.whatsapp_messages to service_role;

create function private.enqueue_lead_welcome() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_message_id uuid;
begin
  if new.whatsapp_consent then
    insert into public.whatsapp_messages(lead_id) values (new.id) returning id into v_message_id;
    perform pgmq.send('whatsapp_outbound', jsonb_build_object('messageId', v_message_id));
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_lead_welcome() from public, anon, authenticated;
create trigger enqueue_lead_welcome after insert on public.leads
for each row execute function private.enqueue_lead_welcome();

create function public.submit_lead(
  p_idempotency_key uuid, p_name text, p_phone text, p_email text,
  p_whatsapp_consent boolean, p_consent_version text, p_ip_hash text
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
  perform pg_advisory_xact_lock(1, hashtext(p_idempotency_key::text));
  select * into v_existing from public.leads where idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.name, v_existing.phone, v_existing.email, v_existing.whatsapp_consent)
       is distinct from (p_name, p_phone, p_email, p_whatsapp_consent) then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    return jsonb_build_object('outcome', 'replayed');
  end if;
  perform pg_advisory_xact_lock(2, hashtext(p_ip_hash));
  -- Rolling window, serialized per hashed IP across all Vercel instances.
  select count(*), min(created_at) into v_count, v_oldest from private.lead_request_log
    where ip_hash = p_ip_hash and created_at > v_now - interval '10 minutes';
  if v_count >= 5 then
    return jsonb_build_object('outcome', 'rate_limited', 'retry_after',
      greatest(1, ceil(extract(epoch from v_oldest + interval '10 minutes' - v_now))::integer));
  end if;
  insert into private.lead_request_log(ip_hash) values (p_ip_hash);
  insert into public.leads(idempotency_key, name, phone, email, whatsapp_consent,
    whatsapp_consent_at, whatsapp_consent_version)
  values (p_idempotency_key, p_name, p_phone, p_email, p_whatsapp_consent,
    case when p_whatsapp_consent then v_now end,
    case when p_whatsapp_consent then p_consent_version end);
  return jsonb_build_object('outcome', 'created');
end;
$$;
revoke all on function public.submit_lead(uuid, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.submit_lead(uuid, text, text, text, boolean, text, text) to service_role;
