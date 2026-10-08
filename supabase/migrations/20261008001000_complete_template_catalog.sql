-- Store Meta's complete catalog, independently of welcome-worker eligibility.
alter table public.whatsapp_templates add column meta_status text not null default 'APPROVED'
  check (meta_status ~ '^[A-Z_]{1,64}$');
alter table public.whatsapp_templates add column components jsonb not null default '[]'::jsonb
  check (jsonb_typeof(components) = 'array');
update public.whatsapp_templates set meta_status='UNAVAILABLE' where not approved;
comment on column public.whatsapp_templates.approved is 'Eligible for the welcome worker: approved by Meta and compatible with its single name parameter.';
alter table public.whatsapp_templates drop constraint whatsapp_templates_body_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_body_check
  check (char_length(body) <= 4096 and (not approved or char_length(body) >= 1));
alter table public.whatsapp_templates drop constraint whatsapp_templates_single_name_parameter;
alter table public.whatsapp_templates add constraint whatsapp_templates_single_name_parameter
  check (not approved or (meta_status='APPROVED' and char_length(body)-char_length(replace(body,'{{1}}',''))=5
    and position('{{' in replace(body,'{{1}}',''))=0));

create or replace function public.sync_whatsapp_templates(p_templates jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_templates is null or jsonb_typeof(p_templates) <> 'array' or jsonb_array_length(p_templates) > 1000 then
    raise exception 'Invalid catalog';
  end if;
  perform pg_advisory_xact_lock(4,0);
  update public.whatsapp_templates set approved=false, meta_status='UNAVAILABLE', verified_at=clock_timestamp()
    where approved or meta_status <> 'UNAVAILABLE';
  insert into public.whatsapp_templates(name,language,body,approved,meta_status,components,verified_at)
    select name, language, body, coalesce(approved,true) and coalesce(meta_status,'APPROVED')='APPROVED',
      coalesce(meta_status,'APPROVED'), coalesce(components,'[]'::jsonb), clock_timestamp()
    from jsonb_to_recordset(p_templates) as t(name text, language text, body text, approved boolean, meta_status text, components jsonb)
    on conflict (name,language) do update set body=excluded.body, approved=excluded.approved,
      meta_status=excluded.meta_status, components=excluded.components, verified_at=excluded.verified_at;
end;
$$;
revoke all on function public.sync_whatsapp_templates(jsonb) from public, anon, authenticated;
grant execute on function public.sync_whatsapp_templates(jsonb) to service_role;
