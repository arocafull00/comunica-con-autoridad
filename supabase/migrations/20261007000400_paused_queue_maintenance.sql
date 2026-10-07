-- Pause must not prevent cleanup of completed jobs or uncertain, interrupted sends.
create or replace function public.claim_configured_whatsapp_job(p_queue_id bigint, p_graph_api_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_settings public.whatsapp_settings; v_template public.whatsapp_templates;
  v_payload jsonb; v_message public.whatsapp_messages;
begin
  -- Keep the existing queue -> message -> slot lock order.
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
  -- A retry must not send a template that was withdrawn from the approved catalog.
  if v_message.template_name is not null then
    perform 1 from public.whatsapp_templates where name=v_message.template_name
      and language=v_message.template_language and approved for share;
    if not found then return jsonb_build_object('action','paused'); end if;
  end if;
  return public.claim_whatsapp_job(p_queue_id,v_template.name,v_template.language,p_graph_api_version);
end;
$$;
revoke all on function public.claim_configured_whatsapp_job(bigint,text) from public, anon, authenticated;
grant execute on function public.claim_configured_whatsapp_job(bigint,text) to service_role;
