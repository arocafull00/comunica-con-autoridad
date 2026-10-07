-- Owner-only catalog refresh. This does not create or submit templates to Meta.
create function public.sync_whatsapp_templates(p_templates jsonb) returns void
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
    where body like '%{{1}}%' and body not like '%{{2}}%'
    on conflict (name,language) do update set body=excluded.body, approved=true, verified_at=excluded.verified_at;
end;
$$;
revoke all on function public.sync_whatsapp_templates(jsonb) from public, anon, authenticated;
grant execute on function public.sync_whatsapp_templates(jsonb) to service_role;
