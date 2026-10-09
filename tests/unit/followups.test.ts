import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleCalWebhook } from "../../lib/followups/cal";
import { handleWhatsappWebhook } from "../../lib/followups/whatsapp";
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
  it.each([
    { type: "text", text: { body: "  confirmo  " } },
    { type: "text", text: { body: "¡Confirmo! ✅" } },
    { type: "button", button: { text: "CONFIRMO" } },
    { type: "button", button: { text: "Confirmar asistencia", payload: "CONFIRMO" } },
    { type: "interactive", interactive: { button_reply: { title: "CONFIRMO" } } },
    { type: "interactive", interactive: { button_reply: { title: "Confirmar asistencia", id: "CONFIRMO" } } },
  ])("confirms attendance for $type replies", async reply => {
    const value = { object: inbound.object, entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "123" }, messages: [{ id: "wamid.reply", from: "34612345678", timestamp, ...reply }],
    } }] }] };
    const save = vi.fn();
    expect((await handleWhatsappWebhook(signed(value, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "123", save })).status).toBe(200);
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: "wamid.reply", phone: "+34612345678", confirms: true, optsOut: false })]);
  });
  it.each(["BAJA", "  baja  ", "¡Baja!", "STOP", " stop. "])("opts out with %s without persisting message content", async body => {
    const value = structuredClone(inbound);
    value.entry[0].changes[0].value.messages[0].text.body = body;
    const save = vi.fn();
    await handleWhatsappWebhook(signed(value, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "123", save });
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ confirms: false, optsOut: true })]);
    expect(save.mock.calls[0][0][0]).not.toHaveProperty("text");
  });
  it.each(["no confirmo", "confirmo mañana", "confirmado", "bajada", "stopping", "", "Hola"])("does not infer a command from %s", async body => {
    const value = structuredClone(inbound);
    value.entry[0].changes[0].value.messages[0].text.body = body;
    const save = vi.fn();
    await handleWhatsappWebhook(signed(value, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "123", save });
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ confirms: false, optsOut: false })]);
  });
  it.each([
    { type: "image" },
    { type: "button", button: { text: "Dejar de recibir mensajes", payload: "STOP" } },
    { type: "interactive", interactive: { button_reply: { title: "Confirmo", id: "BAJA" } } },
  ])("records $type replies and gives opt-out priority over confirmation", async reply => {
    const value = structuredClone(inbound);
    value.entry[0].changes[0].value.messages = [{ id: "wamid.reply", from: "34612345678", timestamp, text: { body: "CONFIRMO" }, ...reply }];
    const save = vi.fn();
    expect((await handleWhatsappWebhook(signed(value, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "123", save })).status).toBe(200);
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ confirms: false, optsOut: reply.type !== "image" })]);
  });
  it("rejects invalid signatures, missing configuration and future timestamps", async () => {
    const save = vi.fn();
    expect((await handleWhatsappWebhook(signed(inbound, "x-hub-signature-256", "sha256=", "wrong"), { secret, phoneNumberId: "123", save })).status).toBe(401);
    expect((await handleWhatsappWebhook(signed(inbound, "x-hub-signature-256", "sha256="), { secret, save })).status).toBe(503);
    const value = structuredClone(inbound);
    value.entry[0].changes[0].value.messages[0].timestamp = Math.floor(Date.now() / 1000 + 600).toString();
    expect((await handleWhatsappWebhook(signed(value, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "123", save })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("ignores messages to another business phone and status notifications", async () => {
    const save = vi.fn();
    await handleWhatsappWebhook(signed(inbound, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "other", save });
    const status = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { statuses: [{ status: "delivered" }] } }] }] };
    await handleWhatsappWebhook(signed(status, "x-hub-signature-256", "sha256="), { secret, phoneNumberId: "123", save });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("email unsubscribe tokens", () => {
  it("accepts only the signed registration, without email data in the URL", () => {
    const registrationId = randomUUID();
    const token = unsubscribeToken(registrationId, secret);
    expect(readUnsubscribeToken(token, secret)).toBe(registrationId);
    expect(readUnsubscribeToken(token.replace(registrationId, randomUUID()), secret)).toBeNull();
    expect(readUnsubscribeToken(token, "different-secret-at-least-32-characters")).toBeNull();
    expect(token).not.toContain("@");
  });
});
