-- Fixed WhatsApp sequences. No external delivery, confirmation or cancellation is activated.
-- Exact copy is shared with lib/followups/messages.json; only name and Meet URL vary.
insert into public.followup_steps(key,channel,scope,delay_seconds,parameter,body)
select key,channel,scope,delay_seconds,parameter,body from jsonb_to_recordset($copy$[{"key": "booking_confirmation", "channel": "whatsapp", "scope": "booking", "delay_seconds": 0, "parameter": null, "body": "¡Hola! Vi que reservaste tu sesión 🙌🏻\nLa idea de la llamada es:\n\n- Entender bien tu caso y qué quieres mejorar.\n- Detectar tus principales puntos de mejora.\n- Valorar si realmente tiene sentido que trabajemos juntos.\n- Si encaja, explicarte cómo trabajamos y cuál sería el siguiente paso.\n\nSi vemos que podemos ayudarte de verdad, te explicaré cómo lo enfocaríamos contigo.\nTengo ganas de conocerte y analizar tu caso. Seguro que podemos sacar bastante en claro 😄"}, {"key": "booking_short_notice", "channel": "whatsapp", "scope": "booking", "delay_seconds": 0, "parameter": null, "body": "¡Hola! Vi que reservaste tu sesión 🙌🏻\nTe cuento lo que haremos: veremos tu caso, qué quieres mejorar y si tiene sentido que trabajemos juntos.\nReserva unos 45 minutos y entra desde un sitio tranquilo.\n*Para mantener la sesión, respóndeme “CONFIRMO”. Si no recibimos confirmación, el administrador revisará tu reserva.*\n¡Nos vemos pronto!"}, {"key": "booking_24h", "channel": "whatsapp", "scope": "booking", "delay_seconds": -86400, "parameter": null, "body": "Mañana tenemos nuestra sesión. 🙌🏻\nReserva unos 45 minutos y, si puedes, entra desde un sitio tranquilo.\nLa idea es que salgamos de la llamada con bastante claridad sobre qué deberías trabajar y cómo hacerlo.\nPara reservar ese espacio exclusivamente para ti, necesito que confirmes tu asistencia respondiendo “CONFIRMO” a este mensaje.\nSi no recibimos confirmación, el administrador revisará tu reserva antes de mantener la plaza."}, {"key": "booking_2h", "channel": "whatsapp", "scope": "booking", "delay_seconds": -7200, "parameter": "meetingUrl", "body": "Nos vemos en un par de horas 👌\nRecuerda que si no has CONFIRMADO tu asistencia con antelación por este chat no se realizará la reunión.\nTe dejo aquí el enlace para que lo tengas localizado:\n{{meetingUrl}}"}, {"key": "booking_15m", "channel": "whatsapp", "scope": "booking", "delay_seconds": -900, "parameter": null, "body": "En 15 minutos empezamos. Nos vemos ahora."}, {"key": "webinar_1h", "channel": "whatsapp", "scope": "webinar", "delay_seconds": 3600, "parameter": "name", "body": "Gracias por apuntarte a la clase {{name}}! ¿Pudiste verla entera? 👀\n\nAntes de dejarlo ahí, dime un una cosa: ¿qué es lo que más estás buscando mejorar ahora mismo en tu comunicación?"}, {"key": "webinar_1d", "channel": "whatsapp", "scope": "webinar", "delay_seconds": 86400, "parameter": null, "body": "Una de las cosas que más veo es gente que sabe perfectamente qué quiere decir, pero no consigue que su mensaje tenga el peso que debería. 🙌🏻\nSi quieres que analicemos dónde te está pasando a ti, puedes reservar aquí:\nhttps://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion"}, {"key": "webinar_3d", "channel": "whatsapp", "scope": "webinar", "delay_seconds": 259200, "parameter": null, "body": "Cierro por aquí para no llenarte de mensajes.\nSi en algún momento decides que quieres trabajar seriamente tu comunicación, influencia o ventas, puedes reservar directamente desde el link que te pasé. Un abrazo! 🙌🏻"}]$copy$::jsonb)
as t(key text,channel text,scope text,delay_seconds integer,parameter text,body text)
on conflict(key) do update set channel=excluded.channel,scope=excluded.scope,
  delay_seconds=excluded.delay_seconds,parameter=excluded.parameter,body=excluded.body;

create or replace function private.schedule_call_followups(p_uid text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.call_bookings; v_now timestamptz:=clock_timestamp(); v_short boolean; v_under_two boolean;
begin
  select * into b from public.call_bookings where uid=p_uid;
  if not found or b.status<>'booked' or b.registration_id is null or b.start_time<=v_now then return; end if;
  -- Choose from the actual booking/reschedule timestamp, not delayed webhook receipt.
  v_short:=b.start_time<b.last_event_at+interval '24 hours';
  v_under_two:=b.start_time<b.last_event_at+interval '2 hours';
  insert into public.followup_jobs(registration_id,step,booking_uid,booking_revision,scheduled_at,expires_at,status,last_error)
    select b.registration_id,s.key,b.uid,b.revision,s.due_at,
      case when s.key in ('booking_confirmation','booking_short_notice') then b.start_time
        else least(b.start_time,s.due_at+interval '30 minutes') end,
      case when s.reason is null then 'pending' else 'suppressed' end,s.reason
    from (
      select f.key,
        case when f.key in ('booking_confirmation','booking_short_notice') then v_now else b.start_time+make_interval(secs=>f.delay_seconds) end as due_at,
        case
          when v_under_two and f.key<>'booking_15m' then 'not_needed_short_notice'
          when f.key='booking_confirmation' and v_short then 'not_needed_variant'
          when f.key='booking_short_notice' and not v_short then 'not_needed_variant'
          when f.key not in ('booking_confirmation','booking_short_notice') and b.start_time+make_interval(secs=>f.delay_seconds)<=v_now then 'reminder_time_elapsed'
          else null end as reason
      from public.followup_steps f where f.scope='booking'
    ) s
    on conflict do nothing;
end;
$$;

-- Automatic attendance confirmation remains paused in lib/followups/whatsapp.ts.
-- Future iteration: define a deadline before implementing automatic cancellation.
-- For this release only the administrator can cancel in Cal.com; its webhook suppresses reminders.

-- Bind each automation once, by exact Spanish body. Subsequent syncs never switch names.
-- Missing, edited, non-approved or unsupported provider templates stop that step.
create function private.refresh_fixed_whatsapp_templates() returns void
language plpgsql security definer set search_path = '' as $$
declare s public.followup_steps; t private.followup_templates; w public.whatsapp_templates; v_count integer; v_body text;
begin
  perform pg_advisory_xact_lock(8,0);
  for s in select * from public.followup_steps where channel='whatsapp' loop
    v_body:=case when s.parameter is null then s.body else replace(s.body,'{{'||s.parameter||'}}','{{1}}') end;
    select * into t from private.followup_templates where step=s.key;
    if found then
      update private.followup_templates set approved=exists(
        select 1 from public.whatsapp_templates c where c.name=t.name and c.language=t.language
          and c.language in ('es','es_ES') and c.meta_status='APPROVED'
          and replace(c.body,E'\r\n',E'\n')=v_body
          and jsonb_array_length(c.components)=1 and c.components->0->>'type'='BODY'),
        verified_at=clock_timestamp() where step=s.key;
    else
      select count(*) into v_count from public.whatsapp_templates c
        where c.language in ('es','es_ES') and c.meta_status not in ('UNAVAILABLE','DELETED','PENDING_DELETION')
          and replace(c.body,E'\r\n',E'\n')=v_body
          and jsonb_array_length(c.components)=1 and c.components->0->>'type'='BODY';
      if v_count=1 then
        select * into w from public.whatsapp_templates c
          where c.language in ('es','es_ES') and c.meta_status not in ('UNAVAILABLE','DELETED','PENDING_DELETION')
            and replace(c.body,E'\r\n',E'\n')=v_body
            and jsonb_array_length(c.components)=1 and c.components->0->>'type'='BODY';
        insert into private.followup_templates(step,name,language,approved)
          values(s.key,w.name,w.language,w.meta_status='APPROVED');
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function private.refresh_fixed_whatsapp_templates() from public,anon,authenticated,service_role;

-- Keep the full Meta catalog and fixed bindings in one transaction.
alter function public.sync_whatsapp_templates(jsonb) rename to sync_whatsapp_catalog_base;
alter function public.sync_whatsapp_catalog_base(jsonb) set schema private;
revoke all on function private.sync_whatsapp_catalog_base(jsonb) from public,anon,authenticated,service_role;
create function public.sync_whatsapp_templates(p_templates jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(8,0);
  perform private.sync_whatsapp_catalog_base(p_templates);
  perform private.refresh_fixed_whatsapp_templates();
end;
$$;
revoke all on function public.sync_whatsapp_templates(jsonb) from public,anon,authenticated;
grant execute on function public.sync_whatsapp_templates(jsonb) to service_role;

-- Retain the setup script for existing deployments; it now accepts all eight fixed steps.
create or replace function public.sync_followup_templates(p_templates jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare t jsonb; s public.followup_steps;
begin
  perform pg_advisory_xact_lock(8,0);
  if p_templates is null or jsonb_typeof(p_templates)<>'array' or jsonb_array_length(p_templates)>8 then raise exception 'Invalid templates'; end if;
  update private.followup_templates set approved=false,verified_at=clock_timestamp();
  for t in select value from jsonb_array_elements(p_templates) loop
    select * into s from public.followup_steps where key=t->>'step' and channel='whatsapp';
    if not found or t->>'body' is distinct from (case when s.parameter is null then s.body else replace(s.body,'{{'||s.parameter||'}}','{{1}}') end) then raise exception 'Template body mismatch'; end if;
    insert into private.followup_templates(step,name,language,approved) values(s.key,t->>'name',t->>'language',true)
      on conflict(step) do update set name=excluded.name,language=excluded.language,approved=true,verified_at=clock_timestamp();
  end loop;
end;
$$;

create function public.read_whatsapp_automation_catalog() returns table(
  key text,body text,parameter text,template_name text,language text,meta_status text,ready boolean)
language sql security definer set search_path = '' as $$
  select s.key,s.body,s.parameter,t.name,t.language,w.meta_status,coalesce(t.approved,false)
    from public.followup_steps s left join private.followup_templates t on t.step=s.key
    left join public.whatsapp_templates w on w.name=t.name and w.language=t.language
    where s.channel='whatsapp';
$$;
revoke all on function public.read_whatsapp_automation_catalog() from public,anon,authenticated;
grant execute on function public.read_whatsapp_automation_catalog() to service_role;

alter table public.whatsapp_settings drop constraint whatsapp_settings_check;

-- A delivery switch does not select or edit any template, including the legacy welcome.
create function public.set_whatsapp_delivery(p_actor uuid,p_revision integer,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_settings public.whatsapp_settings;
begin
  if p_revision is null or p_revision<0 or p_enabled is null then raise exception 'Invalid settings'; end if;
  perform pg_advisory_xact_lock(8,0);
  perform 1 from public.admin_accounts where user_id=p_actor and active for share;
  if not found then raise exception 'Active administrator required'; end if;
  select * into v_settings from public.whatsapp_settings where singleton for update;
  if v_settings.revision<>p_revision then return jsonb_build_object('outcome','conflict'); end if;
  if p_enabled and not exists(select 1 from private.followup_templates where approved) then raise exception 'Approved automation required'; end if;
  update public.whatsapp_settings set enabled=p_enabled,revision=revision+1,
    updated_at=clock_timestamp(),updated_by=p_actor where singleton;
  insert into public.admin_audit(actor_id,actor_email,action,details)
    select p_actor,email,'whatsapp_settings_changed',jsonb_build_object('previous',jsonb_build_object('enabled',v_settings.enabled,'template_id',v_settings.template_id),
      'enabled',p_enabled,'template_id',v_settings.template_id) from auth.users where id=p_actor;
  return jsonb_build_object('outcome','saved');
end;
$$;
revoke all on function public.set_whatsapp_delivery(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.set_whatsapp_delivery(uuid,integer,boolean) to service_role;

-- Never retry an earlier payload with a changed body or a different parameter contract.
alter function public.claim_followup_job(uuid,boolean,boolean) rename to claim_fixed_followup_job_base;
alter function public.claim_fixed_followup_job_base(uuid,boolean,boolean) set schema private;
revoke all on function private.claim_fixed_followup_job_base(uuid,boolean,boolean) from public,anon,authenticated,service_role;
create function public.claim_followup_job(p_job_id uuid,p_email boolean,p_whatsapp boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(8,0);
  perform 1 from public.followup_jobs j join public.followup_steps s on s.key=j.step
    where j.id=p_job_id and j.status='pending' and s.channel='whatsapp' and not j.test_mode and j.payload is not null
      and (j.payload->>'body',j.payload->>'parameter') is distinct from (s.body,s.parameter) for update of j;
  if found then
    update public.followup_jobs set status='suppressed',last_error='automation_content_changed' where id=p_job_id;
    return jsonb_build_object('action','skip');
  end if;
  return private.claim_fixed_followup_job_base(p_job_id,p_email,p_whatsapp);
end;
$$;
revoke all on function public.claim_followup_job(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_followup_job(uuid,boolean,boolean) to service_role;

-- Revalidate current catalog mappings without requeueing or rescheduling existing jobs.
select private.refresh_fixed_whatsapp_templates();
