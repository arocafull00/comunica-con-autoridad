-- Keep the existing lead transaction and add independently auditable email consent.
alter table public.leads
  add column communications_consent boolean not null default false,
  add column communications_consent_at timestamptz,
  add column communications_consent_version text,
  add constraint communications_consent_evidence check (not communications_consent or
    (communications_consent_at is not null and nullif(communications_consent_version,'') is not null));

alter function public.submit_lead(uuid,text,text,text,boolean,text,text,text,text,text,text,text,text)
  rename to submit_lead_without_communications;
alter function public.submit_lead_without_communications(uuid,text,text,text,boolean,text,text,text,text,text,text,text,text)
  set schema private;
revoke all on function private.submit_lead_without_communications(uuid,text,text,text,boolean,text,text,text,text,text,text,text,text)
  from public,anon,authenticated,service_role;

create function public.submit_lead(
  p_idempotency_key uuid,p_name text,p_phone text,p_email text,p_whatsapp_consent boolean,
  p_consent_version text,p_ip_hash text,p_utm_source text default null,p_utm_medium text default null,
  p_utm_campaign text default null,p_profession text default null,p_situation text default null,
  p_goal text default null,p_communications_consent boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_previous boolean;
begin
  if p_communications_consent is null then raise exception 'Consent must be boolean'; end if;
  perform pg_advisory_xact_lock(1,hashtext(p_idempotency_key::text));
  select communications_consent into v_previous from public.leads where idempotency_key=p_idempotency_key;
  if found and v_previous is distinct from p_communications_consent then return jsonb_build_object('outcome','conflict'); end if;
  v_result:=private.submit_lead_without_communications(p_idempotency_key,p_name,p_phone,p_email,p_whatsapp_consent,
    p_consent_version,p_ip_hash,p_utm_source,p_utm_medium,p_utm_campaign,p_profession,p_situation,p_goal);
  if v_result->>'outcome'='created' and p_communications_consent then
    update public.leads set communications_consent=true,communications_consent_at=clock_timestamp(),
      communications_consent_version=p_consent_version where idempotency_key=p_idempotency_key;
  end if;
  return v_result;
end;
$$;
revoke all on function public.submit_lead(uuid,text,text,text,boolean,text,text,text,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.submit_lead(uuid,text,text,text,boolean,text,text,text,text,text,text,text,text,boolean) to service_role;

-- Withdrawal updates evidence and pending jobs atomically; claims also recheck consent.
create or replace function public.unsubscribe_webinar_email(p_registration_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(8,0);
  update public.webinar_registrations set email_unsubscribed_at=coalesce(email_unsubscribed_at,clock_timestamp()) where id=p_registration_id;
  update public.leads l set communications_consent=false from public.webinar_registrations r where r.id=p_registration_id and l.email=r.email;
  update public.followup_jobs j set status='suppressed',last_error='email_unsubscribed'
    from public.followup_steps s where j.registration_id=p_registration_id and j.step=s.key and s.channel='email' and j.status='pending';
end;
$$;
