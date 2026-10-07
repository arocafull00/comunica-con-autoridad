create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create function private.invoke_whatsapp_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'whatsapp_project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'whatsapp_worker_service_role_jwt';
  if v_url is null or v_key is null then raise exception 'Worker invocation is not configured'; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/process-whatsapp-queue',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb, timeout_milliseconds := 90000
  );
end;
$$;
revoke all on function private.invoke_whatsapp_worker() from public, anon, authenticated;
select cron.schedule('process-whatsapp-queue', '30 seconds', 'select private.invoke_whatsapp_worker();');
select cron.alter_job((select jobid from cron.job where jobname = 'process-whatsapp-queue'), active := false);

-- Expired rate-limit entries contain only hashes, and need no long-term retention.
select cron.schedule('lead-rate-limit-cleanup', '17 * * * *',
  $$delete from private.lead_request_log where created_at < now() - interval '1 day';$$);
select cron.schedule('cron-history-cleanup', '41 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days';$$);
