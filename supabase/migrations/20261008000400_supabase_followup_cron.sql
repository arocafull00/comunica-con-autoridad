-- Supabase schedules the Next.js worker; credentials remain outside migrations.
-- Keep new environments paused until their Vault values are configured.
create function private.invoke_followup_worker() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'followup_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'followup_cron_secret';
  if v_url is null or rtrim(v_url, '/') !~ '^https://[^/?#[:space:]]+$'
    or v_secret is null or char_length(v_secret) < 32 or v_secret ~ '[[:space:]]' then
    raise exception 'Follow-up worker invocation is not configured';
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/api/followups/process',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 90000
  );
end;
$$;
revoke all on function private.invoke_followup_worker() from public, anon, authenticated, service_role;

select cron.schedule('process-followup-queue', '* * * * *', 'select private.invoke_followup_worker();');
select cron.alter_job((select jobid from cron.job where jobname = 'process-followup-queue'), active := false);
