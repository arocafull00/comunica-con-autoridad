-- A late duplicate create must never restore a cancelled booking, even if its
-- webhook envelope was produced again with a newer timestamp.
alter function public.record_cal_booking(jsonb) rename to record_cal_booking_base;
alter function public.record_cal_booking_base(jsonb) set schema private;
revoke all on function private.record_cal_booking_base(jsonb) from public,anon,authenticated,service_role;
create function public.record_cal_booking(p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(8,0);
  if p_event->>'event'='BOOKING_CREATED' and exists(
    select 1 from public.call_bookings where uid=p_event->>'uid' and status='cancelled'
  ) then return jsonb_build_object('outcome','ignored'); end if;
  return private.record_cal_booking_base(p_event);
end;
$$;
revoke all on function public.record_cal_booking(jsonb) from public,anon,authenticated;
grant execute on function public.record_cal_booking(jsonb) to service_role;

-- Check ambiguity for the whole telephone, across all registration emails.
create or replace function public.record_whatsapp_replies(p_messages jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare m jsonb; r public.webinar_registrations; v_time timestamptz; v_booking text; v_count integer;
begin
  perform pg_advisory_xact_lock(8,0);
  if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>1000 then raise exception 'Invalid replies'; end if;
  for m in select value from jsonb_array_elements(p_messages) loop
    v_time := (m->>'receivedAt')::timestamptz;
    insert into private.followup_replies(provider_id,phone,received_at,confirms,opts_out)
      values(m->>'id',m->>'phone',v_time,(m->>'confirms')::boolean,(m->>'optsOut')::boolean) on conflict do nothing;
    if not found then continue; end if;
    if (m->>'optsOut')::boolean then update public.leads set whatsapp_consent=false where phone=m->>'phone'; end if;
    for r in select wr.* from public.webinar_registrations wr join public.leads l on l.id=wr.lead_id
      where l.phone=m->>'phone' and wr.registered_at<=v_time loop
      update public.webinar_registrations set whatsapp_replied_at=greatest(whatsapp_replied_at,v_time) where id=r.id;
      update public.followup_jobs set status='suppressed',last_error='contact_replied'
        where registration_id=r.id and step='webinar_3d' and status='pending';
    end loop;
    if (m->>'confirms')::boolean then
      select count(*),min(b.uid) into v_count,v_booking from public.call_bookings b
        join public.webinar_registrations wr on wr.id=b.registration_id join public.leads l on l.id=wr.lead_id
        where l.phone=m->>'phone' and b.status='booked' and b.start_time>v_time;
      if v_count=1 then update public.call_bookings set confirmed_at=v_time where uid=v_booking and last_event_at<=v_time; end if;
    end if;
  end loop;
end;
$$;
