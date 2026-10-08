import { z } from "zod";
import { signedWebhook, WebhookBodyError, webhookJson } from "./webhook";

const uid = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const date = z.iso.datetime({ offset: true });
const envelope = z.object({ triggerEvent: z.string(), createdAt: date });
const booking = z.object({
  uid, rescheduleUid: uid.nullish(), type: z.string().max(200),
  startTime: date, endTime: date,
  attendees: z.array(z.object({ email: z.email().max(254), timeZone: z.string().max(100).optional() })).min(1).max(100),
  responses: z.object({ email: z.object({ value: z.email().max(254) }).optional() }).optional(),
  metadata: z.object({ videoCallUrl: z.string().max(2048).optional() }).optional(),
  location: z.string().max(2048).optional(),
}).refine(value => Date.parse(value.endTime) > Date.parse(value.startTime));
export type CalBooking = {
  uid: string; previousUid: string | null; event: string; eventAt: string;
  email: string; startTime: string; endTime: string; timeZone: string; meetingUrl: string | null;
};

export async function handleCalWebhook(request: Request, deps: {
  secret?: string; eventSlug?: string; save: (event: CalBooking) => Promise<unknown>;
}) {
  try {
    const raw = await signedWebhook(request, deps.secret, "x-cal-signature-256");
    const event = envelope.safeParse(raw);
    if (!event.success) return webhookJson(400, { ok: false });
    if (!["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"].includes(event.data.triggerEvent)) return webhookJson(200, { ok: true, ignored: true });
    const data = booking.safeParse((raw as { payload?: unknown }).payload);
    if (!data.success) return webhookJson(400, { ok: false });
    const payload = data.data;
    if (payload.type !== (deps.eventSlug || "sesion-gratuita-comunicacion")) return webhookJson(200, { ok: true, ignored: true });
    // Prefer the booker's response, rather than accidentally matching an invited guest.
    const email = payload.responses?.email?.value ?? payload.attendees[0].email;
    const attendee = payload.attendees.find(person => person.email.toLowerCase() === email.toLowerCase());
    if (!attendee) return webhookJson(400, { ok: false });
    const timeZone = attendee.timeZone || "Europe/Madrid";
    try { new Intl.DateTimeFormat("es", { timeZone }); } catch { return webhookJson(400, { ok: false }); }
    const candidate = payload.metadata?.videoCallUrl || payload.location;
    let meetingUrl: string | null = null;
    if (candidate) {
      try {
        const url = new URL(candidate);
        if (url.protocol === "https:" && !url.username && !url.password) meetingUrl = url.href;
      } catch { /* A provider marker or physical address is not a meeting URL. */ }
    }
    await deps.save({ uid: payload.uid, previousUid: event.data.triggerEvent === "BOOKING_RESCHEDULED" ? payload.rescheduleUid ?? null : null,
      event: event.data.triggerEvent, eventAt: event.data.createdAt, email: email.toLowerCase(),
      startTime: payload.startTime, endTime: payload.endTime, timeZone, meetingUrl });
    return webhookJson(200, { ok: true });
  } catch (error) {
    if (!(error instanceof WebhookBodyError)) console.error("cal_webhook_unavailable");
    return webhookJson(error instanceof WebhookBodyError ? error.status : 503, { ok: false });
  }
}
