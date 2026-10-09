import { z } from "zod";
import { signedWebhook, WebhookBodyError, webhookJson } from "./webhook";

const payloadSchema = z.object({ object: z.literal("whatsapp_business_account"), entry: z.array(z.object({
  changes: z.array(z.object({ field: z.string(), value: z.object({
    metadata: z.object({ phone_number_id: z.string() }).optional(),
    messages: z.array(z.object({ id: z.string().min(1).max(300), from: z.string().regex(/^[1-9][0-9]{6,14}$/),
      timestamp: z.string().regex(/^\d{1,12}$/), type: z.string(),
      text: z.object({ body: z.string().max(4096) }).optional(),
      button: z.object({ text: z.string().max(4096) }).optional(),
      interactive: z.object({ button_reply: z.object({ title: z.string().max(4096) }).optional() }).optional(),
    })).max(1000).optional(),
  }) })).max(1000),
})).max(1000) });
export type WhatsappReply = { id: string; phone: string; receivedAt: string; confirms: boolean; optsOut: boolean };

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
      for (const message of change.value.messages ?? []) {
        const time = Number(message.timestamp) * 1000;
        if (!Number.isFinite(time) || time <= 0 || time > Date.now() + 300_000) return webhookJson(400, { ok: false });
        const text = (message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title ?? "").trim().toUpperCase();
        // TODO: Retomar en una futura iteración la confirmación automática de asistencia
        // al recibir CONFIRMO (por texto o botón). En pausa por decisión del usuario.
        // const confirms = text === "CONFIRMO";
        const confirms = false;
        messages.push({ id: message.id, phone: `+${message.from}`, receivedAt: new Date(time).toISOString(), confirms, optsOut: ["BAJA", "STOP"].includes(text) });
      }
    }
    if (messages.length) await deps.save(messages);
    return webhookJson(200, { ok: true });
  } catch (error) {
    if (!(error instanceof WebhookBodyError)) console.error("whatsapp_reply_unavailable");
    return webhookJson(error instanceof WebhookBodyError ? error.status : 503, { ok: false });
  }
}
