alter table public.leads drop constraint masterclass_answers_complete;
alter table public.leads add constraint masterclass_answers_complete check (
  (profession is null and situation is null and goal is null and commitment is null and investment is null and application_reasons is null and admission_decision is null and qualified_at is null) or
  (profession is not null and situation is not null and goal is not null and commitment is null and investment is null and application_reasons is null and admission_decision is null) or
  (profession is not null and goal is not null and commitment is not null and investment is not null and application_reasons is null and admission_decision is null and qualified_at is not null) or
  (profession is not null and goal is not null and commitment is not null and investment is not null and application_reasons is not null and admission_decision is not null and qualified_at is not null)
);

create function public.complete_masterclass_profile(
  p_submission_id uuid,p_profession text,p_situation text,p_goal text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; result text:='created';
begin
  if p_submission_id is null then return jsonb_build_object('outcome','missing'); end if;
  p_profession:=nullif(btrim(p_profession),'');
  if p_profession is null or char_length(p_profession)>200 or p_profession ~ E'[\r\n\t]'
    or p_situation is null or p_situation not in (
      'Trabajo por cuenta ajena y quiero mejorar cómo comunico en mi entorno profesional.',
      'Trabajo en ventas o trato directamente con clientes.',
      'Lidero un equipo o tengo personas a mi cargo.',
      'Tengo mi propio negocio, proyecto o marca personal.',
      'Estoy en una etapa de cambio, crecimiento o búsqueda de nuevas oportunidades.')
    or p_goal is null or p_goal not in (
      'Transmitir más seguridad, autoridad y confianza al comunicar.',
      'Influir y persuadir mejor sin sonar agresivo ni forzado.',
      'Vender mejor, gestionar objeciones y cerrar más.',
      'Adaptarme mejor a distintos tipos de personas y conversaciones.',
      'Expresarme con más claridad y controlar mejor los nervios o la presión.') then
    raise exception 'Invalid qualification';
  end if;
  perform pg_advisory_xact_lock(8,0);
  perform pg_advisory_xact_lock(1,hashtext(p_submission_id::text));
  select * into l from public.leads where idempotency_key=p_submission_id for update;
  if not found or l.name is null or l.phone is null
    or not exists(select 1 from public.webinar_registrations where email=l.email) then
    return jsonb_build_object('outcome','missing');
  end if;
  if l.qualified_at is not null then
    if l.commitment is not null or (l.profession,l.situation,l.goal) is distinct from (p_profession,p_situation,p_goal) then
      return jsonb_build_object('outcome','conflict');
    end if;
    result:='replayed';
  else
    update public.leads set profession=p_profession,situation=p_situation,goal=p_goal,qualified_at=clock_timestamp()
      where id=l.id returning * into l;
    update public.webinar_registrations set lead_id=l.id where email=l.email and lead_id<>l.id;
  end if;
  return jsonb_build_object('outcome',result,'lead',private.masterclass_sheet_lead(l));
end;
$$;
revoke all on function public.complete_masterclass_profile(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_masterclass_profile(uuid,text,text,text) to service_role;
