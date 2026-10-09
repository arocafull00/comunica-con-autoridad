-- Accept approved fixed text as well as one positional name parameter.
alter table public.whatsapp_templates drop constraint whatsapp_templates_single_name_parameter;
alter table public.whatsapp_templates add constraint whatsapp_templates_single_name_parameter
  check (not approved or (meta_status='APPROVED' and btrim(body) <> ''
    and replace(body,'{{1}}','') !~ '[{}]'
    and char_length(body)-char_length(replace(body,'{{1}}','')) in (0,5)));
comment on column public.whatsapp_templates.approved is 'Eligible for welcome sends: approved by Meta, fixed text or one positional name parameter.';

-- Keep the parameter contract with the message snapshot across retries.
alter table public.whatsapp_messages add column template_parameter_count smallint
  check (template_parameter_count in (0,1));
update public.whatsapp_messages set template_parameter_count=1 where template_name is not null;

create or replace function public.claim_configured_whatsapp_job(p_queue_id bigint, p_graph_api_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_settings public.whatsapp_settings; v_template public.whatsapp_templates;
  v_payload jsonb; v_message public.whatsapp_messages; v_claim jsonb; v_parameter_count smallint;
begin
  -- Preserve queue -> message -> slot lock order and maintenance while paused.
  select message into v_payload from pgmq.q_whatsapp_outbound where msg_id=p_queue_id for update;
  if not found then return jsonb_build_object('action','skip'); end if;
  if coalesce(v_payload->>'messageId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.claim_whatsapp_job(p_queue_id,'maintenance','es',p_graph_api_version);
  end if;
  select * into v_message from public.whatsapp_messages where id=(v_payload->>'messageId')::uuid for update;
  if not found or v_message.status <> 'pending' then
    return public.claim_whatsapp_job(p_queue_id,'maintenance','es',p_graph_api_version);
  end if;
  select * into v_settings from public.whatsapp_settings where singleton for share;
  if not v_settings.enabled then return jsonb_build_object('action','paused'); end if;
  select * into v_template from public.whatsapp_templates where id=v_settings.template_id and approved for share;
  if not found then return jsonb_build_object('action','paused'); end if;
  -- Retried messages use their original template and parameter count.
  if v_message.template_name is not null then
    select * into v_template from public.whatsapp_templates where name=v_message.template_name
      and language=v_message.template_language and approved for share;
    if not found then return jsonb_build_object('action','paused'); end if;
  end if;
  v_parameter_count := coalesce(v_message.template_parameter_count,
    case when position('{{1}}' in v_template.body)>0 then 1 else 0 end);
  v_claim := public.claim_whatsapp_job(p_queue_id,v_template.name,v_template.language,p_graph_api_version);
  if v_claim->>'action'='claimed' then
    update public.whatsapp_messages set template_parameter_count=v_parameter_count where id=v_message.id;
    return v_claim || jsonb_build_object('template_parameter_count',v_parameter_count);
  end if;
  return v_claim;
end;
$$;
revoke all on function public.claim_configured_whatsapp_job(bigint,text) from public, anon, authenticated;
grant execute on function public.claim_configured_whatsapp_job(bigint,text) to service_role;

-- Eligibility is refreshed by the sync function after deploying the updated worker.
-- This migration does not select a welcome template or enable delivery.
