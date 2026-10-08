import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleCalWebhook } from "../../lib/followups/cal";
import { handleWhatsappWebhook } from "../../lib/followups/whatsapp";
import { handleFollowupWorker, loadFollowupConfig, processFollowups, sendFollowup, type FollowupMessage, type FollowupRpc } from "../../lib/followups/worker";
import { readUnsubscribeToken, unsubscribeToken } from "../../lib/followups/unsubscribe";

const secret = "test-only-webhook-secret-at-least-32-characters";
const event = {
  triggerEvent: "BOOKING_CREATED", createdAt: "2026-10-08T10:00:00Z",
  payload: { uid: "booking-1", type: "sesion-gratuita-comunicacion", startTime: "2026-10-10T14:00:00Z", endTime: "2026-10-10T14:45:00Z",
    attendees: [{ email: "ADRIAN@example.com", timeZone: "Europe/Madrid" }], metadata: { videoCallUrl: "https://meet.google.com/abc-defg-hij" } },
};
function signed(body: unknown, header = "x-cal-signature-256", prefix = "", signatureSecret = secret) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://example.com/api/webhook", { method: "POST", headers: { "Content-Type": "application/json",
    [header]: prefix + createHmac("sha256", signatureSecret).update(raw).digest("hex") }, body: raw });
}

describe("Cal webhook", () => {
  it("verifies original bytes, normalizes email and stores actual bookings", async () => {
    const save = vi.fn().mockResolvedValue({ outcome: "saved" });
    expect((await handleCalWebhook(signed(JSON.stringify(event, null, 2)), { secret, save })).status).toBe(200);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ uid: "booking-1", email: "adrian@example.com", meetingUrl: "https://meet.google.com/abc-defg-hij", timeZone: "Europe/Madrid" }));
  });
  it("rejects tampering, oversized and malformed bodies without persistence", async () => {
    const save = vi.fn();
    expect((await handleCalWebhook(signed(event, undefined, "", "wrong"), { secret, save })).status).toBe(401);
    expect((await handleCalWebhook(signed("invalid-json"), { secret, save })).status).toBe(400);
    expect((await handleCalWebhook(signed("a".repeat(262145)), { secret, save })).status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });
  it("does not accept a missing secret and does not leak database failures", async () => {
    const save = vi.fn();
    expect((await handleCalWebhook(signed(event), { save })).status).toBe(503);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    save.mockRejectedValue(new Error("sensitive detail"));
    const response = await handleCalWebhook(signed(event), { secret, save });
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("sensitive"); log.mockRestore();
  });
  it.each(["BOOKING_REQUESTED", "MEETING_STARTED", "FORM_SUBMITTED"])("ignores %s without creating a booking", async triggerEvent => {
    const save = vi.fn();
    expect((await handleCalWebhook(signed({ ...event, triggerEvent }), { secret, save })).status).toBe(200);
    expect(save).not.toHaveBeenCalled();
  });
  it("filters other event types and rejects invalid dates/zones", async () => {
    const save = vi.fn();
    expect((await handleCalWebhook(signed({ ...event, payload: { ...event.payload, type: "other" } }), { secret, save })).status).toBe(200);
    expect((await handleCalWebhook(signed({ ...event, payload: { ...event.payload, endTime: "2026-10-09T10:00:00Z" } }), { secret, save })).status).toBe(400);
    expect((await handleCalWebhook(signed({ ...event, payload: { ...event.payload, attendees: [{ email: "a@example.com", timeZone: "invalid" }] } }), { secret, save })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("uses the booker response rather than matching a guest", async () => {
    const save = vi.fn();
    await handleCalWebhook(signed({ ...event, payload: { ...event.payload,
      attendees: [{ email: "guest@example.com" }, ...event.payload.attendees], responses: { email: { value: "ADRIAN@example.com" } } } }), { secret, save });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ email: "adrian@example.com" }));
  });
  it("stores previous UID for rescheduling and never treats a provider marker as a meet URL", async () => {
    const save = vi.fn();
    await handleCalWebhook(signed({ ...event, triggerEvent: "BOOKING_RESCHEDULED", payload: { ...event.payload, rescheduleUid: "old-booking", metadata: {}, location: "integrations:google:meet" } }), { secret, save });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ previousUid: "old-booking", meetingUrl: null }));
  });
});

const timestamp = Math.floor(Date.now() / 1000).toString();
const inbound = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "123" },
  messages: [{ id: "wamid.reply", from: "34612345678", timestamp, type: "text", text: { body: "  confirmo  " } }] } }] }] };
describe("WhatsApp replies", () => {
  it("validates signature and recognizes an exact CONFIRMO", async () => {
    const save = vi.fn();
    expect((await handleWhatsappWebhook(signed(inbound, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "123", save })).status).toBe(200);
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: "wamid.reply", phone: "+34612345678", confirms: true, optsOut: false })]);
  });
  it("counts nontext replies and recognizes BAJA without logging their content", async () => {
    const value = structuredClone(inbound);
    value.entry[0].changes[0].value.messages[0].text.body = "BAJA";
    const save = vi.fn();
    await handleWhatsappWebhook(signed(value, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "123", save });
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ confirms: false, optsOut: true })]);
  });
  it("ignores messages to another business phone and status notifications", async () => {
    const save = vi.fn();
    await handleWhatsappWebhook(signed(inbound, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "other", save });
    const status = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { statuses: [{ status: "delivered" }] } }] }] };
    await handleWhatsappWebhook(signed(status, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "123", save });
    expect(save).not.toHaveBeenCalled();
  });
});

const config = { email: { key: "test-key", from: "Ignacio <test@example.com>", siteUrl: "https://example.com", unsubscribeSecret: secret },
  whatsapp: { token: "test-token", phoneNumberId: "123", version: "v99.0" } };
const message: FollowupMessage = { id: randomUUID(), registrationId: randomUUID(), channel: "email", step: "email_2",
  email: "adrian@example.com", phone: "+34612345678", name: "Adrián", time: "16:00 (Europe/Madrid)", meetingUrl: "https://meet.google.com/abc",
  subject: "Clase", body: "Hola {{name}}", parameter: null, templateName: "approved_template", templateLanguage: "es" };
describe("durable followup sender", () => {
  it("keeps sending disabled by default, even with credentials", async () => {
    expect(loadFollowupConfig({ RESEND_API_KEY: "secret" })).toEqual({ email: null, whatsapp: null });
    const rpc = vi.fn(); const fetcher = vi.fn();
    const request = new Request("https://example.com/process", { headers: { authorization: `Bearer ${secret}` } });
    expect((await handleFollowupWorker(request, { FOLLOWUP_CRON_SECRET: secret }, rpc, fetcher)).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    expect((await handleFollowupWorker(new Request("https://example.com/process"), {}, rpc)).status).toBe(401);
  });
  it("sends Resend an idempotency key, personalized copy and signed unsubscribe link", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "email-provider-id" }));
    expect(await sendFollowup(message, config, fetcher)).toEqual({ outcome: "sent", providerId: "email-provider-id" });
    const [url, init] = fetcher.mock.calls[0]; const body = JSON.parse(init.body);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers["Idempotency-Key"]).toBe(`followup/${message.id}`);
    expect(body.text).toContain("Hola Adrián"); expect(body.text).toContain(unsubscribeToken(message.registrationId, secret));
  });
  it.each([null, "meetingUrl", "time", "name"] as const)("sends WhatsApp with the correct parameter %s", async parameter => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.sent" }] }));
    await sendFollowup({ ...message, channel: "whatsapp", parameter }, config, fetcher);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.to).toBe("34612345678");
    if (parameter) expect(body.template.components[0].parameters[0].text).toBe(message[parameter]);
    else expect(body.template.components).toBeUndefined();
  });
  it("never blindly retries a timeout, malformed success or unstructured provider failure", async () => {
    for (const fetcher of [vi.fn().mockRejectedValue(new Error("timeout")), vi.fn().mockResolvedValue(Response.json({})), vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 }))]) {
      expect(await sendFollowup(message, config, fetcher)).toEqual({ outcome: "unknown", error: "delivery_unknown" });
    }
  });
  it("retries structured throttling and fails permanent rejections", async () => {
    expect(await sendFollowup(message, config, vi.fn().mockResolvedValue(Response.json({ name: "rate_limit_exceeded" }, { status: 429 })))).toMatchObject({ outcome: "retry" });
    expect(await sendFollowup(message, config, vi.fn().mockResolvedValue(Response.json({ name: "validation_error" }, { status: 422 })))).toMatchObject({ outcome: "failed" });
    expect(await sendFollowup({ ...message, channel: "whatsapp" }, config, vi.fn().mockResolvedValue(Response.json({ error: { code: 131000 } }, { status: 500 })))).toMatchObject({ outcome: "retry" });
  });
  it("finishes owned claims and does not send skipped jobs", async () => {
    const rpc = vi.fn().mockResolvedValueOnce([{ id: message.id }, { id: "skipped" }])
      .mockImplementation(async name => name === "claim_followup_job" ? { action: "skip" } : true);
    const fetcher = vi.fn();
    expect(await processFollowups(rpc as FollowupRpc, config, fetcher)).toMatchObject({ skipped: 2, sent: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    const calls: string[] = [];
    const active: FollowupRpc = async <T>(name: string) => {
      calls.push(name);
      return (name === "read_followup_jobs" ? [{ id: message.id }] : name === "claim_followup_job" ? { action: "claimed", claimToken: "token", message } : true) as T;
    };
    expect(await processFollowups(active, config, vi.fn().mockResolvedValue(Response.json({ id: "sent" })))).toMatchObject({ sent: 1 });
    expect(calls).toEqual(["read_followup_jobs", "claim_followup_job", "finish_followup_job"]);
  });
});

describe("email unsubscribe tokens", () => {
  it("accepts only the signed registration, without email data in the URL", () => {
    const token = unsubscribeToken(message.registrationId, secret);
    expect(readUnsubscribeToken(token, secret)).toBe(message.registrationId);
    expect(readUnsubscribeToken(token.replace(message.registrationId, randomUUID()), secret)).toBeNull();
    expect(readUnsubscribeToken(token, "different-secret-at-least-32-characters")).toBeNull();
    expect(token).not.toContain("@");
  });
});
