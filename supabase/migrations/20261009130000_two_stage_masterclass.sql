-- Two phases: contact grants video access; qualification updates that same lead.
-- Existing six-answer registrations remain valid.
alter table public.leads alter column name drop not null;
alter table public.leads
  add column commitment text check (char_length(commitment) between 1 and 300),
  add column investment text check (char_length(investment) between 1 and 100),
  add column qualified_at timestamptz;
alter table public.leads drop constraint masterclass_answers_complete;
alter table public.leads add constraint masterclass_answers_complete check (
  (profession is null and situation is null and goal is null and commitment is null and investment is null and qualified_at is null) or
  (profession is not null and situation is not null and goal is not null and commitment is null and investment is null and qualified_at is null) or
  (profession is not null and goal is not null and commitment is not null and investment is not null and qualified_at is not null)
);

-- Internal representation for the two-stage Sheets sync; never exposed to anon.
create function private.masterclass_sheet_lead(l public.leads) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('name',coalesce(l.name,''),'phone',l.phone,'email',l.email,
    'whatsappConsent',l.whatsapp_consent,'communicationsConsent',l.communications_consent,
    'profession',l.profession,'situation',l.situation,'goal',l.goal,
    'commitment',l.commitment,'investment',l.investment);
$$;
revoke all on function private.masterclass_sheet_lead(public.leads) from public,anon,authenticated,service_role;

create function public.submit_masterclass_access(
  p_idempotency_key uuid,p_phone text,p_email text,p_whatsapp_consent boolean,
  p_communications_consent boolean,p_consent_version text,p_ip_hash text,
  p_utm_source text default null,p_utm_medium text default null,p_utm_campaign text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; result jsonb;
begin
  if p_idempotency_key is null or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid submission metadata';
  end if;
  perform pg_advisory_xact_lock(1,hashtext(p_idempotency_key::text));
  select * into l from public.leads where idempotency_key=p_idempotency_key;
  if found then
    -- Ignore qualification fields when replaying the initial contact submission.
    if (l.name,l.phone,l.email,l.whatsapp_consent,l.communications_consent,l.utm_source,l.utm_medium,l.utm_campaign)
      is distinct from (null::text,p_phone,p_email,p_whatsapp_consent,p_communications_consent,
        nullif(btrim(p_utm_source),''),nullif(btrim(p_utm_medium),''),nullif(btrim(p_utm_campaign),'')) then
      return jsonb_build_object('outcome','conflict');
    end if;
    return jsonb_build_object('outcome','replayed','lead',private.masterclass_sheet_lead(l));
  end if;
  result:=public.submit_lead(p_idempotency_key,null,p_phone,p_email,p_whatsapp_consent,
    p_consent_version,p_ip_hash,p_utm_source,p_utm_medium,p_utm_campaign,null,null,null,p_communications_consent);
  if result->>'outcome'='created' then
    select * into l from public.leads where idempotency_key=p_idempotency_key;
    return result || jsonb_build_object('lead',private.masterclass_sheet_lead(l));
  end if;
  return result;
end;
$$;
revoke all on function public.submit_masterclass_access(uuid,text,text,boolean,boolean,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_masterclass_access(uuid,text,text,boolean,boolean,text,text,text,text,text) to service_role;

create function public.complete_masterclass_qualification(
  p_submission_id uuid,p_profession text,p_goal text,p_commitment text,p_investment text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; result text:='created';
begin
  perform pg_advisory_xact_lock(1,hashtext(p_submission_id::text));
  select * into l from public.leads where idempotency_key=p_submission_id for update;
  if not found or not exists(select 1 from public.webinar_registrations where email=l.email) then
    return jsonb_build_object('outcome','missing');
  end if;
  p_profession:=nullif(btrim(p_profession),'');
  if p_profession is null or char_length(p_profession)>200 or p_profession ~ E'[\r\n\t]'
    or p_goal is null or p_goal not in (
      'Comunicar con más seguridad, autoridad y confianza',
      'Influir mejor en las personas y generar más impacto',
      'Vender, negociar y tratar objeciones mejor',
      'Mejorar mi comunicación en general, tanto profesional como personal')
    or p_commitment is null or p_commitment not in (
      'Muy alto: estoy dispuesto/a a aplicar, practicar y seguir las indicaciones',
      'Alto: me comprometería seriamente con el proceso',
      'Medio: dependería del tiempo y la carga de trabajo',
      'Bajo: ahora mismo no podría dedicarle demasiada atención')
    or p_investment is null or p_investment not in (
      'Menos de 500€','Entre 500€ y 1.200€','Entre 1.200€ y 2.500€','Más de 2.500€','Podría invertir con pagos a cuotas.') then
    raise exception 'Invalid qualification';
  end if;
  if l.qualified_at is not null then
    if (l.profession,l.goal,l.commitment,l.investment) is distinct from (p_profession,p_goal,p_commitment,p_investment) then
      return jsonb_build_object('outcome','conflict');
    end if;
    result:='replayed';
  else
    update public.leads set profession=p_profession,goal=p_goal,commitment=p_commitment,
      investment=p_investment,qualified_at=clock_timestamp() where id=l.id returning * into l;
  end if;
  return jsonb_build_object('outcome',result,'lead',private.masterclass_sheet_lead(l));
end;
$$;
revoke all on function public.complete_masterclass_qualification(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_masterclass_qualification(uuid,text,text,text,text) to service_role;

-- The existing follow-up schedule starts at contact capture, after Sheets succeeds.
create or replace function public.register_webinar(p_submission_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.leads; r public.webinar_registrations; b public.call_bookings;
begin
  perform pg_advisory_xact_lock(8,0);
  select * into l from public.leads where idempotency_key=p_submission_id;
  if not found then raise exception 'Contact required'; end if;
  insert into public.webinar_registrations(lead_id,email) values(l.id,l.email)
    on conflict(email) do nothing returning * into r;
  if not found then select * into r from public.webinar_registrations where email=l.email; return r.id; end if;
  update public.webinar_registrations set whatsapp_replied_at=(select max(received_at) from private.followup_replies where phone=l.phone and received_at>=r.registered_at)
    where id=r.id;
  insert into public.followup_jobs(registration_id,step,scheduled_at,expires_at)
    select r.id,s.key,r.registered_at+make_interval(secs=>s.delay_seconds),
      r.registered_at+make_interval(secs=>s.delay_seconds)+interval '6 hours'
    from public.followup_steps s where s.scope='webinar'
      and ((s.channel='whatsapp' and l.whatsapp_consent) or (s.channel='email' and l.communications_consent));
  -- Bookings can arrive before the form or before the Sheets copy succeeds.
  update public.call_bookings set registration_id=r.id where email=l.email and registration_id is null;
  if exists(select 1 from public.call_bookings where registration_id=r.id) then
    update public.followup_jobs set status='suppressed',last_error='call_already_booked'
      where registration_id=r.id and step in ('webinar_1h','webinar_1d','webinar_3d') and status='pending';
  end if;
  for b in select * from public.call_bookings where registration_id=r.id and status='booked' loop
    perform private.schedule_call_followups(b.uid);
  end loop;
  return r.id;
end;
$$;

