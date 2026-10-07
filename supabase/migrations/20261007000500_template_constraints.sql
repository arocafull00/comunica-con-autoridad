-- PostgreSQL limits repetition bounds to 255; use a separate length check for names.
alter table public.whatsapp_templates drop constraint whatsapp_templates_name_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_name_check
  check (name ~ '^[a-z0-9_]+$' and char_length(name) between 1 and 512);
alter table public.whatsapp_templates add constraint whatsapp_templates_single_name_parameter
  check (char_length(body)-char_length(replace(body,'{{1}}',''))=5 and position('{{' in replace(body,'{{1}}',''))=0);
create or replace function public.sync_whatsapp_templates(p_templates jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_templates is null or jsonb_typeof(p_templates) <> 'array' or jsonb_array_length(p_templates) > 1000 then
    raise exception 'Invalid catalog';
  end if;
  perform pg_advisory_xact_lock(4,0);
  update public.whatsapp_templates set approved=false, verified_at=clock_timestamp();
  insert into public.whatsapp_templates(name,language,body,approved,verified_at)
    select name, language, body, true, clock_timestamp()
    from jsonb_to_recordset(p_templates) as t(name text, language text, body text)
    on conflict (name,language) do update set body=excluded.body, approved=true, verified_at=excluded.verified_at;
end;
$$;
revoke all on function public.sync_whatsapp_templates(jsonb) from public, anon, authenticated;
grant execute on function public.sync_whatsapp_templates(jsonb) to service_role;
