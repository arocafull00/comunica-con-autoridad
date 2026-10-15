create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  utm_source text not null check (utm_source ~ '^[a-z0-9_.-]{1,100}$'),
  utm_medium text not null check (utm_medium ~ '^[a-z0-9_.-]{1,100}$'),
  utm_campaign text not null check (utm_campaign ~ '^[a-z0-9_.-]{1,100}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (utm_source, utm_medium, utm_campaign)
);
alter table public.campaigns enable row level security;
revoke all on public.campaigns from public, anon, authenticated, service_role;
grant select, insert, delete on public.campaigns to service_role;

create function public.get_campaigns()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row_to_json(c) order by c.created_at desc), '[]'::jsonb) from (
    select campaign.id, campaign.utm_source, campaign.utm_medium, campaign.utm_campaign, campaign.created_at,
      (select count(*) from public.leads lead where lead.source = 'web' and lead.utm_source = campaign.utm_source
        and lead.utm_medium = campaign.utm_medium and lead.utm_campaign = campaign.utm_campaign) as leads
    from public.campaigns campaign) c;
$$;
revoke all on function public.get_campaigns() from public, anon, authenticated;
grant execute on function public.get_campaigns() to service_role;
