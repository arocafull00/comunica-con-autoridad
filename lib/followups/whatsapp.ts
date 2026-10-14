import { z } from "zod";
import { signedWebhook, WebhookBodyError, webhookJson } from "./webhook";

const payloadSchema = z.object({ object: z.literal("whatsapp_business_account"), entry: z.array(z.object({
  changes: z.array(z.object({ field: z.string(), value: z.object({
    metadata: z.object({ phone_number_id: z.string() }).optional(),
    messages: z.array(z.object({ id: z.string().min(1).max(300), from: z.string().regex(/^[1-9][0-9]{6,14}$/),
      timestamp: z.string().regex(/^\d{1,12}$/), type: z.string(),
      text: z.object({ body: z.string().max(4096) }).optional(),
      button: z.object({ text: z.string().max(4096), payload: z.string().max(4096).optional() }).optional(),
      interactive: z.object({ button_reply: z.object({ title: z.string().max(4096), id: z.string().max(4096).optional() }).optional() }).optional(),
    })).max(1000).optional(),
    statuses: z.array(z.unknown()).max(1000).optional(),
  }) })).max(1000),
})).max(1000) });
// Parsed per item so an unexpected status shape never rejects the replies in the same payload.
const failedStatusSchema = z.object({ id: z.string().max(300), status: z.literal("failed"),
  errors: z.array(z.object({ code: z.number(), title: z.string().max(300).optional() })).max(10).optional() });
export type WhatsappReply = { id: string; phone: string; receivedAt: string; confirms: boolean; optsOut: boolean;
  oks: boolean; buttonJobId: string | null };
// Quick replies of the booking templates carry the job id (see buttonPayload in the follow-up worker).
const BUTTON_PAYLOAD = /^followup:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function normalizeKeyword(value: string | undefined) {
  // Match a complete command, so phrases such as "no confirmo" cannot confirm attendance.
  return (value ?? "").normalize("NFKC").toUpperCase().replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "");
}

export async function handleWhatsappWebhook(request: Request, deps: {
  secret?: string; phoneNumberId?: string; save: (messages: WhatsappReply[]) => Promise<void>;
}) {
  try {
    const parsed = payloadSchema.safeParse(await signedWebhook(request, deps.secret, "x-hub-signature-256", "sha256="));
    if (!parsed.success) return webhookJson(400, { ok: false });
    if (!deps.phoneNumberId) return webhookJson(503, { ok: false });
    const messages: WhatsappReply[] = [];
    for (const entry of parsed.data.entry) for (const change of entry.changes) {
      if (change.field !== "messages" || change.value.metadata?.phone_number_id !== deps.phoneNumberId) continue;
      for (const status of change.value.statuses ?? []) {
        const failed = failedStatusSchema.safeParse(status);
        // Meta reports delivery failures only here. Log the message id and error codes, never the recipient.
        if (failed.success) console.error("whatsapp_delivery_failed", { id: failed.data.id, status: failed.data.status,
          errors: (failed.data.errors ?? []).map(({ code, title }) => ({ code, title })) });
      }
      for (const message of change.value.messages ?? []) {
        const time = Number(message.timestamp) * 1000;
        if (!Number.isFinite(time) || time <= 0 || time > Date.now() + 300_000) return webhookJson(400, { ok: false });
        const payload = message.type === "button" ? message.button?.payload
          : message.type === "interactive" ? message.interactive?.button_reply?.id : undefined;
        const keywords = (message.type === "text" ? [message.text?.body]
          : message.type === "button" ? [message.button?.text, payload]
          : message.type === "interactive" ? [message.interactive?.button_reply?.title, payload]
          : []).map(normalizeKeyword);
        const optsOut = keywords.some(keyword => keyword === "BAJA" || keyword === "STOP");
        const confirms = !optsOut && keywords.some(keyword => keyword === "CONFIRMO" || keyword === "CONFIRMAR");
        const oks = !optsOut && keywords.includes("OK");
        messages.push({ id: message.id, phone: `+${message.from}`, receivedAt: new Date(time).toISOString(), confirms, optsOut, oks,
          buttonJobId: payload?.match(BUTTON_PAYLOAD)?.[1] ?? null });
      }
    }
    if (messages.length) await deps.save(messages);
    return webhookJson(200, { ok: true });
  } catch (error) {
    if (!(error instanceof WebhookBodyError)) console.error("whatsapp_reply_unavailable");
    return webhookJson(error instanceof WebhookBodyError ? error.status : 503, { ok: false });
  }
}
