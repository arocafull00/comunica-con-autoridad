alter table public.whatsapp_templates add column category text not null default 'UNKNOWN'
  check (category in ('UNKNOWN','UTILITY','MARKETING','AUTHENTICATION'));
alter table public.whatsapp_templates add column meta_id text check (meta_id ~ '^[0-9]+$');
alter table public.whatsapp_templates add column version_of uuid references public.whatsapp_templates(id) on delete set null;

create or replace function public.sync_whatsapp_templates(p_templates jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_templates is null or jsonb_typeof(p_templates) <> 'array' or jsonb_array_length(p_templates) > 1000 then
    raise exception 'Invalid catalog';
  end if;
  perform pg_advisory_xact_lock(4,0);
  update public.whatsapp_templates set approved=false, meta_status='UNAVAILABLE', verified_at=clock_timestamp()
    where approved or meta_status <> 'UNAVAILABLE';
  insert into public.whatsapp_templates(name,language,body,approved,meta_status,components,category,meta_id,verified_at)
    select name, language, body, coalesce(approved,true) and coalesce(meta_status,'APPROVED')='APPROVED',
      coalesce(meta_status,'APPROVED'), coalesce(components,'[]'::jsonb), coalesce(category,'UNKNOWN'), meta_id, clock_timestamp()
    from jsonb_to_recordset(p_templates) as t(name text, language text, body text, approved boolean, meta_status text, components jsonb, category text, meta_id text)
    on conflict (name,language) do update set body=excluded.body, approved=excluded.approved,
      meta_status=excluded.meta_status, components=excluded.components, category=excluded.category,
      meta_id=excluded.meta_id, verified_at=excluded.verified_at;
end;
$$;
revoke all on function public.sync_whatsapp_templates(jsonb) from public, anon, authenticated;
grant execute on function public.sync_whatsapp_templates(jsonb) to service_role;
