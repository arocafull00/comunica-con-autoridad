-- Move dispatch to Supabase without changing the schedule or existing jobs.
-- Deployment and Vault setup precede activation in each environment.
create or replace function private.invoke_followup_worker() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'followup_project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'followup_worker_service_role_jwt';
  if v_url is null or rtrim(v_url, '/') !~ '^https://[a-z0-9]+[.]supabase[.]co$'
    or v_key is null or char_length(v_key) < 100 then
    raise exception 'Follow-up Edge Function invocation is not configured';
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/process-followup-queue',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb, timeout_milliseconds := 90000
  );
end;
$$;
revoke all on function private.invoke_followup_worker() from public, anon, authenticated, service_role;
