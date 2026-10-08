-- Missing templates/meeting links must not keep occupying every batch and starve emails.
create or replace function public.read_followup_jobs(p_email boolean,p_whatsapp boolean) returns table(id uuid)
language sql security definer set search_path = '' as $$
  select j.id from public.followup_jobs j join public.followup_steps s on s.key=j.step
    where ((s.channel='email' and p_email) or
      (s.channel='whatsapp' and p_whatsapp and (select enabled from public.whatsapp_settings where singleton)))
      and ((j.status='processing' and j.processing_started_at<clock_timestamp()-interval '120 seconds') or
        (j.status='pending' and j.scheduled_at<=clock_timestamp() and (
          j.expires_at<=clock_timestamp() or (
            (j.last_error is distinct from 'missing_template' or exists(
              select 1 from private.followup_templates t where t.step=j.step and t.approved
                and coalesce(j.payload->>'templateName',t.name)=t.name
                and coalesce(j.payload->>'templateLanguage',t.language)=t.language))
            and (j.last_error is distinct from 'missing_meeting_url' or exists(
              select 1 from public.call_bookings b where b.uid=j.booking_uid and b.meeting_url is not null))
          ))))
    order by (j.status='processing') desc,j.scheduled_at limit 10;
$$;

alter function public.claim_followup_job(uuid,boolean,boolean) rename to claim_followup_job_base;
alter function public.claim_followup_job_base(uuid,boolean,boolean) set schema private;
revoke all on function private.claim_followup_job_base(uuid,boolean,boolean) from public,anon,authenticated,service_role;
create function public.claim_followup_job(p_job_id uuid,p_email boolean,p_whatsapp boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  v_result:=private.claim_followup_job_base(p_job_id,p_email,p_whatsapp);
  if v_result->>'action'='missing_template' then
    update public.followup_jobs set last_error='missing_template' where id=p_job_id and status='pending';
  end if;
  return v_result;
end;
$$;
revoke all on function public.claim_followup_job(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_followup_job(uuid,boolean,boolean) to service_role;
