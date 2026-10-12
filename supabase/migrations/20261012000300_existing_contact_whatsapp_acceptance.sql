-- A returning, unqualified contact can accept the new WhatsApp notice too.
-- A retry after BAJA on an already qualified contact must not opt them back in.
create or replace function public.complete_masterclass_qualification_with_contact(
  p_submission_id uuid,p_name text,p_phone text,p_whatsapp_consent_version text,
  p_profession text,p_goal text,p_commitment text,p_investment text,
  p_application_reasons text,p_admission_decision text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; r public.webinar_registrations; b public.call_bookings;
  v_result jsonb; v_now timestamptz:=clock_timestamp(); v_new_contact boolean;
  v_accepting_whatsapp boolean;
begin
  if p_submission_id is null then return jsonb_build_object('outcome','missing'); end if;
  p_name:=nullif(btrim(p_name),'');
  if p_name is null or char_length(p_name) not between 2 and 100 or p_name ~ E'[\r\n\t]'
    or p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$'
    or nullif(btrim(p_whatsapp_consent_version),'') is null then raise exception 'Invalid contact'; end if;
  perform pg_advisory_xact_lock(8,0);
  perform pg_advisory_xact_lock(1,hashtext(p_submission_id::text));
  select * into l from public.leads where idempotency_key=p_submission_id for update;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  select * into r from public.webinar_registrations where lead_id=l.id;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  v_new_contact:=l.phone is null or (l.name is null and l.qualified_at is null);
  if l.phone is not null and l.phone is distinct from p_phone then
    return jsonb_build_object('outcome','conflict');
  end if;
  if not v_new_contact and (l.name,l.phone) is distinct from (p_name,p_phone) then
    return jsonb_build_object('outcome','conflict');
  end if;
  v_accepting_whatsapp:=l.qualified_at is null and not l.whatsapp_consent;
  if v_new_contact or v_accepting_whatsapp then
    update public.leads set name=p_name,phone=p_phone,whatsapp_consent=true,
      whatsapp_consent_at=v_now,whatsapp_consent_version=p_whatsapp_consent_version
      where id=l.id;
  end if;
  v_result:=public.complete_masterclass_qualification(p_submission_id,p_profession,p_goal,
    p_commitment,p_investment,p_application_reasons,p_admission_decision);
  if v_result->>'outcome' not in ('created','replayed') then return v_result; end if;
  if v_new_contact or v_accepting_whatsapp then
    insert into public.followup_jobs(registration_id,step,scheduled_at,expires_at)
      select r.id,s.key,v_now+make_interval(secs=>s.delay_seconds),
        v_now+make_interval(secs=>s.delay_seconds)+interval '6 hours'
      from public.followup_steps s where s.scope='webinar' and s.channel='whatsapp'
      on conflict do nothing;
    update public.followup_jobs set status='suppressed',last_error='call_already_booked'
      where registration_id=r.id and step in ('webinar_1h','webinar_1d','webinar_3d')
        and status='pending' and exists(select 1 from public.call_bookings where registration_id=r.id);
    for b in select * from public.call_bookings where registration_id=r.id and status='booked' loop
      perform private.schedule_call_followups(b.uid);
    end loop;
  end if;
  select * into l from public.leads where id=l.id;
  return v_result || jsonb_build_object('lead',private.masterclass_sheet_lead(l));
end;
$$;
