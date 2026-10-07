-- Two shared leases bound concurrent outbound requests across overlapping workers.
create table private.whatsapp_worker_slots (
  slot integer primary key check (slot in (1, 2)),
  message_id uuid references public.whatsapp_messages(id),
  claim_token uuid,
  leased_until timestamptz
);
insert into private.whatsapp_worker_slots(slot) values (1), (2);
alter table private.whatsapp_worker_slots enable row level security;

create function public.read_whatsapp_jobs()
returns table(queue_id text) language sql security definer set search_path = '' as $$
  select msg_id::text from pgmq.read('whatsapp_outbound', 120, 10);
$$;

create function public.claim_whatsapp_job(
  p_queue_id bigint, p_template_name text, p_template_language text, p_graph_api_version text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
  v_message public.whatsapp_messages;
  v_lead public.leads;
  v_slot integer;
  v_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  select message into v_payload from pgmq.q_whatsapp_outbound where msg_id = p_queue_id for update;
  if not found then return jsonb_build_object('action', 'skip'); end if;
  if coalesce(v_payload->>'messageId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform pgmq.archive('whatsapp_outbound', p_queue_id);
    return jsonb_build_object('action', 'skip');
  end if;
  select * into v_message from public.whatsapp_messages
    where id = (v_payload->>'messageId')::uuid for update;
  if not found or v_message.status in ('sent', 'failed') then
    perform pgmq.archive('whatsapp_outbound', p_queue_id);
    return jsonb_build_object('action', 'skip');
  end if;
  if v_message.status = 'processing' then
    if v_message.processing_started_at + interval '120 seconds' <= v_now then
      update public.whatsapp_messages set status = 'failed', last_error = 'delivery_unknown'
        where id = v_message.id;
      update private.whatsapp_worker_slots set message_id = null, claim_token = null, leased_until = null
        where message_id = v_message.id and claim_token = v_message.claim_token;
      perform pgmq.archive('whatsapp_outbound', p_queue_id);
      return jsonb_build_object('action', 'unknown');
    end if;
    perform pgmq.set_vt('whatsapp_outbound', p_queue_id, 120);
    return jsonb_build_object('action', 'busy');
  end if;
  select * into v_lead from public.leads where id = v_message.lead_id for share;
  if not found or not v_lead.whatsapp_consent then
    update public.whatsapp_messages set status = 'failed', last_error = 'consent_missing' where id = v_message.id;
    perform pgmq.archive('whatsapp_outbound', p_queue_id);
    return jsonb_build_object('action', 'skip');
  end if;
  if v_message.scheduled_at > v_now then
    perform pgmq.set_vt('whatsapp_outbound', p_queue_id, greatest(1, ceil(extract(epoch from v_message.scheduled_at - v_now))::integer));
    return jsonb_build_object('action', 'busy');
  end if;
  if v_message.attempts >= 3 then
    update public.whatsapp_messages set status = 'failed', last_error = 'attempts_exhausted' where id = v_message.id;
    perform pgmq.archive('whatsapp_outbound', p_queue_id);
    return jsonb_build_object('action', 'skip');
  end if;
  if nullif(p_template_name, '') is null or nullif(p_template_language, '') is null or
     p_graph_api_version !~ '^v[0-9]+\.[0-9]+$' then raise exception 'Invalid template configuration'; end if;
  select slot into v_slot from private.whatsapp_worker_slots
    where leased_until is null or leased_until <= v_now order by slot limit 1 for update skip locked;
  if not found then
    perform pgmq.set_vt('whatsapp_outbound', p_queue_id, 30);
    return jsonb_build_object('action', 'busy');
  end if;
  update private.whatsapp_worker_slots set message_id = v_message.id, claim_token = v_token,
    leased_until = v_now + interval '120 seconds' where slot = v_slot;
  update public.whatsapp_messages set status = 'processing', attempts = attempts + 1,
    processing_started_at = v_now, claim_token = v_token,
    template_name = coalesce(template_name, p_template_name),
    template_language = coalesce(template_language, p_template_language),
    graph_api_version = coalesce(graph_api_version, p_graph_api_version)
    where id = v_message.id returning * into v_message;
  return jsonb_build_object('action', 'claimed', 'message_id', v_message.id, 'claim_token', v_token,
    'name', v_lead.name, 'phone', v_lead.phone, 'template_name', v_message.template_name,
    'template_language', v_message.template_language, 'graph_api_version', v_message.graph_api_version);
end;
$$;

create function public.finish_whatsapp_job(
  p_queue_id bigint, p_message_id uuid, p_claim_token uuid, p_outcome text,
  p_provider_message_id text default null, p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_message public.whatsapp_messages; v_delay integer;
begin
  select * into v_message from public.whatsapp_messages where id = p_message_id for update;
  if not found or v_message.status <> 'processing' or v_message.claim_token is distinct from p_claim_token then return false; end if;
  if p_outcome not in ('sent', 'retry', 'failed', 'unknown') or p_outcome is null then raise exception 'Invalid outcome'; end if;
  if p_outcome = 'sent' then
    if nullif(p_provider_message_id, '') is null then raise exception 'Missing provider message id'; end if;
    update public.whatsapp_messages set status = 'sent', provider_message_id = p_provider_message_id,
      sent_at = clock_timestamp(), last_error = null where id = p_message_id;
    perform pgmq.archive('whatsapp_outbound', p_queue_id);
  elsif p_outcome = 'retry' and v_message.attempts < 3 then
    v_delay := case when v_message.attempts = 1 then 60 else 300 end;
    update public.whatsapp_messages set status = 'pending', scheduled_at = clock_timestamp() + make_interval(secs => v_delay),
      last_error = left(p_error, 120), processing_started_at = null, claim_token = null where id = p_message_id;
    perform pgmq.set_vt('whatsapp_outbound', p_queue_id, v_delay);
  else
    update public.whatsapp_messages set status = 'failed',
      last_error = case when p_outcome = 'unknown' then 'delivery_unknown' else left(coalesce(p_error, 'send_failed'), 120) end
      where id = p_message_id;
    perform pgmq.archive('whatsapp_outbound', p_queue_id);
  end if;
  update private.whatsapp_worker_slots set message_id = null, claim_token = null, leased_until = null
    where message_id = p_message_id and claim_token = p_claim_token;
  return true;
end;
$$;

revoke all on function public.read_whatsapp_jobs() from public, anon, authenticated;
revoke all on function public.claim_whatsapp_job(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.finish_whatsapp_job(bigint, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.read_whatsapp_jobs() to service_role;
grant execute on function public.claim_whatsapp_job(bigint, text, text, text) to service_role;
grant execute on function public.finish_whatsapp_job(bigint, uuid, uuid, text, text, text) to service_role;
