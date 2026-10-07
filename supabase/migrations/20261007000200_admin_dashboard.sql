-- All administration goes through the Next.js server, after verified Auth + membership.
create table public.admin_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '^[a-z0-9_]{1,512}$'),
  language text not null check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  body text not null check (char_length(body) between 1 and 4096),
  approved boolean not null default false,
  verified_at timestamptz not null default now(),
  unique(name, language)
);
create table public.whatsapp_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  template_id uuid references public.whatsapp_templates(id),
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (not enabled or template_id is not null)
);
insert into public.whatsapp_settings(singleton) values (true);
create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
create table private.admin_login_log (
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index admin_login_log_ip_time on private.admin_login_log(ip_hash, created_at);
alter table public.admin_accounts enable row level security;
alter table public.whatsapp_templates enable row level security;
alter table public.whatsapp_settings enable row level security;
alter table public.admin_audit enable row level security;
alter table private.admin_login_log enable row level security;
revoke all on public.admin_accounts, public.whatsapp_templates, public.whatsapp_settings, public.admin_audit from public, anon, authenticated, service_role;
grant all on public.admin_accounts, public.whatsapp_templates to service_role;
grant select on public.whatsapp_settings, public.admin_audit to service_role;

create function public.allow_admin_login(p_ip_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid hash'; end if;
  perform pg_advisory_xact_lock(3, hashtext(p_ip_hash));
  delete from private.admin_login_log where created_at < clock_timestamp() - interval '1 day';
  if (select count(*) from private.admin_login_log where ip_hash=p_ip_hash
    and created_at > clock_timestamp() - interval '10 minutes') >= 10 then return false; end if;
  insert into private.admin_login_log(ip_hash) values (p_ip_hash);
  return true;
end;
$$;

create function public.set_whatsapp_settings(p_actor uuid, p_revision integer, p_enabled boolean, p_template_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_settings public.whatsapp_settings;
begin
  perform 1 from public.admin_accounts where user_id=p_actor and active for share;
  if not found then raise exception 'Administrator required'; end if;
  if p_enabled is null or p_revision is null then raise exception 'Invalid settings'; end if;
  select * into v_settings from public.whatsapp_settings where singleton for update;
  if v_settings.revision <> p_revision then return jsonb_build_object('outcome','conflict'); end if;
  if p_template_id is not null then
    perform 1 from public.whatsapp_templates where id=p_template_id and approved for share;
    if not found then raise exception 'Approved template required'; end if;
  elsif p_enabled then raise exception 'Approved template required'; end if;
  update public.whatsapp_settings set enabled=p_enabled, template_id=p_template_id,
    revision=revision+1, updated_at=clock_timestamp(), updated_by=p_actor where singleton;
  insert into public.admin_audit(actor_id,action,details) values (p_actor,'whatsapp_settings_changed',
    jsonb_build_object('previous',to_jsonb(v_settings),'enabled',p_enabled,'template_id',p_template_id,'revision',p_revision+1));
  return jsonb_build_object('outcome','saved');
end;
$$;

-- Settings and pause are checked for every job. Retried messages keep their original snapshot.
create function public.claim_configured_whatsapp_job(p_queue_id bigint, p_graph_api_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_settings public.whatsapp_settings; v_template public.whatsapp_templates;
begin
  select * into v_settings from public.whatsapp_settings where singleton for share;
  if not v_settings.enabled then return jsonb_build_object('action','paused'); end if;
  select * into v_template from public.whatsapp_templates where id=v_settings.template_id and approved for share;
  if not found then return jsonb_build_object('action','paused'); end if;
  return public.claim_whatsapp_job(p_queue_id,v_template.name,v_template.language,p_graph_api_version);
end;
$$;
revoke all on function public.allow_admin_login(text) from public, anon, authenticated;
revoke all on function public.set_whatsapp_settings(uuid,integer,boolean,uuid) from public, anon, authenticated;
revoke all on function public.claim_configured_whatsapp_job(bigint,text) from public, anon, authenticated;
grant execute on function public.allow_admin_login(text) to service_role;
grant execute on function public.set_whatsapp_settings(uuid,integer,boolean,uuid) to service_role;
grant execute on function public.claim_configured_whatsapp_job(bigint,text) to service_role;
