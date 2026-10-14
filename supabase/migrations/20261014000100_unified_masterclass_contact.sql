-- The class is open without registration. "Agendar llamada" saves name, email,
-- mobile and two independent, optional consents before the qualification questions.
-- Earlier RPCs stay available for clients that still send the previous form.

-- Saves one contact submission and starts only the authorised follow-ups.
-- A returning email keeps its registration and existing jobs; earlier consent
-- remains valid until withdrawn (BAJA or email unsubscribe), so an unticked box
-- on a later visit does not silently stop a running sequence.
create function public.submit_masterclass_contact(
  p_idempotency_key uuid,p_name text,p_phone text,p_email text,
  p_communications_consent boolean,p_whatsapp_consent boolean,
  p_email_consent_version text,p_whatsapp_consent_version text,p_ip_hash text,
  p_utm_source text default null,p_utm_medium text default null,p_utm_campaign text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; prev public.leads; r public.webinar_registrations; b public.call_bookings;
  v_count integer; v_oldest timestamptz; v_now timestamptz:=clock_timestamp();
  v_email boolean; v_whatsapp boolean;
begin
  if p_idempotency_key is null or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_communications_consent is null or p_whatsapp_consent is null then raise exception 'Invalid submission metadata'; end if;
  p_email:=lower(btrim(p_email));
  p_name:=nullif(btrim(p_name),'');
  if p_email is null or char_length(p_email) not between 3 and 254 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or p_name is null or char_length(p_name) not between 2 and 100 or p_name ~ E'[\r\n\t]'
    or p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$'
    or (p_communications_consent and nullif(btrim(p_email_consent_version),'') is null)
    or (p_whatsapp_consent and nullif(btrim(p_whatsapp_consent_version),'') is null) then
    raise exception 'Invalid contact';
  end if;
  perform pg_advisory_xact_lock(8,0);
  perform pg_advisory_xact_lock(1,hashtext(p_idempotency_key::text));
  select * into l from public.leads where idempotency_key=p_idempotency_key;
  if found then
    -- Stored consent can be true because it was carried forward; never false when it was requested.
    if (l.name,l.phone,l.email,l.utm_source,l.utm_medium,l.utm_campaign)
      is distinct from (p_name,p_phone,p_email,nullif(btrim(p_utm_source),''),
        nullif(btrim(p_utm_medium),''),nullif(btrim(p_utm_campaign),''))
      or (p_communications_consent and not l.communications_consent)
      or (p_whatsapp_consent and not l.whatsapp_consent) then
      return jsonb_build_object('outcome','conflict');
    end if;
    return jsonb_build_object('outcome','replayed','lead',private.masterclass_sheet_lead(l));
  end if;
  perform pg_advisory_xact_lock(2,hashtext(p_ip_hash));
  select count(*),min(created_at) into v_count,v_oldest from private.lead_request_log
    where ip_hash=p_ip_hash and created_at>v_now-interval '10 minutes';
  if v_count>=5 then
    return jsonb_build_object('outcome','rate_limited','retry_after',
      greatest(1,ceil(extract(epoch from v_oldest+interval '10 minutes'-v_now))::integer));
  end if;
  insert into private.lead_request_log(ip_hash) values(p_ip_hash);

  select p.* into prev from public.webinar_registrations wr join public.leads p on p.id=wr.lead_id where wr.email=p_email;
  v_email:=p_communications_consent or coalesce(prev.communications_consent,false);
  v_whatsapp:=p_whatsapp_consent or coalesce(prev.whatsapp_consent and prev.phone=p_phone,false);
  -- WhatsApp consent is set after the insert: the legacy welcome trigger fires on insert only.
  insert into public.leads(idempotency_key,name,phone,email,communications_consent,
    communications_consent_at,communications_consent_version,utm_source,utm_medium,utm_campaign)
  values(p_idempotency_key,p_name,p_phone,p_email,v_email,
    case when p_communications_consent then v_now when v_email then prev.communications_consent_at end,
    case when p_communications_consent then p_email_consent_version when v_email then prev.communications_consent_version end,
    nullif(btrim(p_utm_source),''),nullif(btrim(p_utm_medium),''),nullif(btrim(p_utm_campaign),''))
  returning * into l;
  if v_whatsapp then
    update public.leads set whatsapp_consent=true,
      whatsapp_consent_at=case when p_whatsapp_consent then v_now else prev.whatsapp_consent_at end,
      whatsapp_consent_version=case when p_whatsapp_consent then p_whatsapp_consent_version else prev.whatsapp_consent_version end
      where id=l.id returning * into l;
  end if;

  insert into public.webinar_registrations(lead_id,email) values(l.id,p_email)
    on conflict(email) do nothing returning * into r;
  if not found then
    -- The latest contact becomes the active one for future messages.
    update public.webinar_registrations set lead_id=l.id where email=p_email returning * into r;
  end if;
  -- Starts missing authorised steps from now; sent, suppressed or pending jobs are kept.
  insert into public.followup_jobs(registration_id,step,scheduled_at,expires_at)
    select r.id,s.key,v_now+make_interval(secs=>s.delay_seconds),
      v_now+make_interval(secs=>s.delay_seconds)+interval '6 hours'
    from public.followup_steps s where s.scope='webinar'
      and ((s.channel='whatsapp' and v_whatsapp) or (s.channel='email' and v_email))
    on conflict do nothing;
  update public.call_bookings set registration_id=r.id where email=p_email and registration_id is null;
  update public.followup_jobs set status='suppressed',last_error='call_already_booked'
    where registration_id=r.id and step in ('webinar_1h','webinar_1d','webinar_3d')
      and status='pending' and exists(select 1 from public.call_bookings where registration_id=r.id);
  for b in select * from public.call_bookings where registration_id=r.id and status='booked' loop
    perform private.schedule_call_followups(b.uid);
  end loop;
  return jsonb_build_object('outcome','created','lead',private.masterclass_sheet_lead(l));
end;
$$;
revoke all on function public.submit_masterclass_contact(uuid,text,text,text,boolean,boolean,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_masterclass_contact(uuid,text,text,text,boolean,boolean,text,text,text,text,text,text) to service_role;

-- Questions after the contact step: adds the current situation, never changes consent.
create function public.complete_masterclass_candidate_qualification(
  p_submission_id uuid,p_profession text,p_situation text,p_goal text,p_commitment text,
  p_investment text,p_application_reasons text,p_admission_decision text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; v_result jsonb;
begin
  if p_submission_id is null then return jsonb_build_object('outcome','missing'); end if;
  if p_situation is null or p_situation not in (
    'Trabajo por cuenta ajena y quiero mejorar cómo comunico en mi entorno profesional.',
    'Trabajo en ventas o trato directamente con clientes.',
    'Lidero un equipo o tengo personas a mi cargo.',
    'Tengo mi propio negocio, proyecto o marca personal.',
    'Estoy en una etapa de cambio, crecimiento o búsqueda de nuevas oportunidades.') then
    raise exception 'Invalid qualification';
  end if;
  perform pg_advisory_xact_lock(8,0);
  perform pg_advisory_xact_lock(1,hashtext(p_submission_id::text));
  select * into l from public.leads where idempotency_key=p_submission_id for update;
  if not found or l.name is null or l.phone is null then return jsonb_build_object('outcome','missing'); end if;
  if l.qualified_at is not null and l.situation is distinct from p_situation then
    return jsonb_build_object('outcome','conflict');
  end if;
  v_result:=public.complete_masterclass_qualification(p_submission_id,p_profession,p_goal,
    p_commitment,p_investment,p_application_reasons,p_admission_decision);
  if v_result->>'outcome' not in ('created','replayed') then return v_result; end if;
  if v_result->>'outcome'='created' then
    update public.leads set situation=p_situation where id=l.id;
    -- A completed form is the active contact, as for repeated registrations.
    update public.webinar_registrations set lead_id=l.id where email=l.email and lead_id<>l.id;
  end if;
  select * into l from public.leads where id=l.id;
  return v_result || jsonb_build_object('lead',private.masterclass_sheet_lead(l));
end;
$$;
revoke all on function public.complete_masterclass_candidate_qualification(uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_masterclass_candidate_qualification(uuid,text,text,text,text,text,text,text) to service_role;
