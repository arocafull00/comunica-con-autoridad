alter table public.leads
  add column application_reasons text check (char_length(application_reasons) between 1 and 2000),
  add column admission_decision text check (admission_decision in ('Sí, reservaré la llamada','No reservaré la llamada'));

alter table public.leads drop constraint masterclass_answers_complete;
alter table public.leads add constraint masterclass_answers_complete check (
  (profession is null and situation is null and goal is null and commitment is null and investment is null and application_reasons is null and admission_decision is null and qualified_at is null) or
  (profession is not null and situation is not null and goal is not null and commitment is null and investment is null and application_reasons is null and admission_decision is null and qualified_at is null) or
  (profession is not null and goal is not null and commitment is not null and investment is not null and application_reasons is null and admission_decision is null and qualified_at is not null) or
  (profession is not null and goal is not null and commitment is not null and investment is not null and application_reasons is not null and admission_decision is not null and qualified_at is not null)
);

create or replace function private.masterclass_sheet_lead(l public.leads) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('name',coalesce(l.name,''),'phone',l.phone,'email',l.email,
    'whatsappConsent',l.whatsapp_consent,'communicationsConsent',l.communications_consent,
    'profession',l.profession,'situation',l.situation,'goal',l.goal,
    'commitment',l.commitment,'investment',l.investment,
    'applicationReasons',l.application_reasons,'admissionDecision',l.admission_decision);
$$;

drop function public.complete_masterclass_qualification(uuid,text,text,text,text);

create function public.complete_masterclass_qualification(
  p_submission_id uuid,p_profession text,p_goal text,p_commitment text,p_investment text,
  p_application_reasons text,p_admission_decision text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; result text:='created';
begin
  perform pg_advisory_xact_lock(1,hashtext(p_submission_id::text));
  select * into l from public.leads where idempotency_key=p_submission_id for update;
  if not found or not exists(select 1 from public.webinar_registrations where email=l.email) then
    return jsonb_build_object('outcome','missing');
  end if;
  p_profession:=nullif(btrim(p_profession),'');
  p_application_reasons:=nullif(btrim(p_application_reasons),'');
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
      'Menos de 500€','Entre 500€ y 1.200€','Entre 1.200€ y 2.500€','Más de 2.500€','Podría invertir con pagos a cuotas.')
    or p_application_reasons is null or char_length(p_application_reasons)>2000
    or p_admission_decision is null or p_admission_decision not in (
      'Sí, reservaré la llamada','No reservaré la llamada') then
    raise exception 'Invalid qualification';
  end if;
  if l.qualified_at is not null then
    if (l.profession,l.goal,l.commitment,l.investment,l.application_reasons,l.admission_decision)
      is distinct from (p_profession,p_goal,p_commitment,p_investment,p_application_reasons,p_admission_decision) then
      return jsonb_build_object('outcome','conflict');
    end if;
    result:='replayed';
  else
    update public.leads set profession=p_profession,goal=p_goal,commitment=p_commitment,
      investment=p_investment,application_reasons=p_application_reasons,
      admission_decision=p_admission_decision,qualified_at=clock_timestamp()
      where id=l.id returning * into l;
  end if;
  return jsonb_build_object('outcome',result,'lead',private.masterclass_sheet_lead(l));
end;
$$;

revoke all on function public.complete_masterclass_qualification(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_masterclass_qualification(uuid,text,text,text,text,text,text) to service_role;
