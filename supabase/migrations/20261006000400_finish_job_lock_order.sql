-- Claim and finish both lock queue -> message -> worker slot, avoiding lock inversion.
create or replace function public.finish_whatsapp_job(
  p_queue_id bigint, p_message_id uuid, p_claim_token uuid, p_outcome text,
  p_provider_message_id text default null, p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_message public.whatsapp_messages; v_delay integer; v_payload jsonb;
begin
  select message into v_payload from pgmq.q_whatsapp_outbound where msg_id = p_queue_id for update;
  if not found or v_payload->>'messageId' is distinct from p_message_id::text then return false; end if;
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
