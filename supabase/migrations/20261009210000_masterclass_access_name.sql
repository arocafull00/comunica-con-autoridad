-- Capture the name with the first-stage contact and include it in replay checks.
-- Existing registrations without a name remain untouched.
drop function public.submit_masterclass_access(uuid,text,text,boolean,boolean,text,text,text,text,text);

create function public.submit_masterclass_access(
  p_idempotency_key uuid,p_name text,p_phone text,p_email text,p_whatsapp_consent boolean,
  p_communications_consent boolean,p_consent_version text,p_ip_hash text,
  p_utm_source text default null,p_utm_medium text default null,p_utm_campaign text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; result jsonb;
begin
  if p_idempotency_key is null or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid submission metadata';
  end if;
  p_name:=nullif(btrim(p_name),'');
  if p_name is null or char_length(p_name) not between 2 and 100 or p_name ~ E'[\r\n\t]' then
    raise exception 'Invalid name';
  end if;
  perform pg_advisory_xact_lock(1,hashtext(p_idempotency_key::text));
  select * into l from public.leads where idempotency_key=p_idempotency_key;
  if found then
    -- Qualification does not change the original contact or its replay identity.
    if (l.name,l.phone,l.email,l.whatsapp_consent,l.communications_consent,l.utm_source,l.utm_medium,l.utm_campaign)
      is distinct from (p_name,p_phone,p_email,p_whatsapp_consent,p_communications_consent,
        nullif(btrim(p_utm_source),''),nullif(btrim(p_utm_medium),''),nullif(btrim(p_utm_campaign),'')) then
      return jsonb_build_object('outcome','conflict');
    end if;
    return jsonb_build_object('outcome','replayed','lead',private.masterclass_sheet_lead(l));
  end if;
  result:=public.submit_lead(p_idempotency_key,p_name,p_phone,p_email,p_whatsapp_consent,
    p_consent_version,p_ip_hash,p_utm_source,p_utm_medium,p_utm_campaign,null,null,null,p_communications_consent);
  if result->>'outcome'='created' then
    select * into l from public.leads where idempotency_key=p_idempotency_key;
    return result || jsonb_build_object('lead',private.masterclass_sheet_lead(l));
  end if;
  return result;
end;
$$;
revoke all on function public.submit_masterclass_access(uuid,text,text,text,boolean,boolean,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_masterclass_access(uuid,text,text,text,boolean,boolean,text,text,text,text,text) to service_role;
