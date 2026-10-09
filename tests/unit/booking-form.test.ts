import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleBookingForm } from "../../lib/leads/booking-handler";
import { accessSchema, qualificationSchema } from "../../lib/leads/booking-validation";
import { signAccessToken, verifyAccessToken } from "../../lib/leads/access-token";
import { BOOKING_GOALS, COMMITMENTS, INVESTMENTS, CAL_BOOKING_URL } from "../../lib/leads/masterclass";

const env = { LEAD_IP_HMAC_SECRET: "local-tests-masterclass-secret-over-32-characters" };
const contact = { phone: "+34612345678", email: "test@example.com", whatsappConsent: false };
const answers = { profession: "Dirección", goal: BOOKING_GOALS[0], commitment: COMMITMENTS[0], investment: INVESTMENTS[1] };
function request(body: unknown, headers: Record<string, string>) {
  return new Request("http://localhost/api/leads/access", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("two-phase masterclass", () => {
  it("accepts contact details without a name and rejects landlines and partial qualification", () => {
    expect(accessSchema.parse(contact)).toMatchObject({ communicationsConsent: false, phone: contact.phone });
    expect(accessSchema.safeParse({ ...contact, phone: "+34911234567" }).success).toBe(false);
    expect(qualificationSchema.safeParse({ ...answers, commitment: undefined }).success).toBe(false);
    expect(qualificationSchema.safeParse({ ...answers, investment: "inventado" }).success).toBe(false);
  });
  it("grants signed access after contact persistence, Sheets and registration, without answers", async () => {
    const persist = vi.fn().mockResolvedValue({ outcome: "created", lead: contact });
    const syncSheets = vi.fn(); const registerWebinar = vi.fn(); const id = randomUUID();
    const response = await handleBookingForm(request(contact, { "Idempotency-Key": id }), "access", { persist, syncSheets, registerWebinar, env });
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(verifyAccessToken(result.accessToken, env.LEAD_IP_HMAC_SECRET)).toBe(id);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ p_email: contact.email, p_phone: contact.phone, p_communications_consent: false }));
    expect(syncSheets.mock.invocationCallOrder[0]).toBeGreaterThan(persist.mock.invocationCallOrder[0]);
    expect(registerWebinar.mock.invocationCallOrder[0]).toBeGreaterThan(syncSheets.mock.invocationCallOrder[0]);
    expect(JSON.stringify(result)).not.toContain(contact.email);
  });
  it("does not grant access or enroll after failed Sheets, and permits the same replay", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const persist = vi.fn().mockResolvedValue({ outcome: "replayed", lead: contact });
    const syncSheets = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValueOnce(undefined);
    const registerWebinar = vi.fn(); const headers = { "Idempotency-Key": randomUUID() };
    expect((await handleBookingForm(request(contact, headers), "access", { persist, syncSheets, registerWebinar, env })).status).toBe(503);
    expect(registerWebinar).not.toHaveBeenCalled();
    expect((await handleBookingForm(request(contact, headers), "access", { persist, syncSheets, registerWebinar, env })).status).toBe(200);
    expect(syncSheets.mock.calls[0][1]).toBe(syncSheets.mock.calls[1][1]);
    log.mockRestore();
  });
  it("blocks forged and expired references before any qualification writes", async () => {
    const id = randomUUID(); const token = signAccessToken(id, env.LEAD_IP_HMAC_SECRET);
    const persist = vi.fn(); const syncSheets = vi.fn();
    for (const bad of [id, `${token}x`, signAccessToken(id, env.LEAD_IP_HMAC_SECRET, 0)]) {
      expect((await handleBookingForm(request(answers, { Authorization: `Bearer ${bad}` }), "qualification", { persist, syncSheets, env })).status).toBe(401);
    }
    expect(persist).not.toHaveBeenCalled();
  });
  it("returns Cal.com only after answers and their Sheets update succeed", async () => {
    const id = randomUUID(); const token = signAccessToken(id, env.LEAD_IP_HMAC_SECRET);
    const persist = vi.fn().mockResolvedValue({ outcome: "created", lead: { ...contact, ...answers } });
    const syncSheets = vi.fn(); const registerWebinar = vi.fn();
    const response = await handleBookingForm(request(answers, { Authorization: `Bearer ${token}` }), "qualification", { persist, syncSheets, registerWebinar, env });
    expect(await response.json()).toMatchObject({ ok: true, bookingUrl: CAL_BOOKING_URL });
    expect(persist).toHaveBeenCalledWith({ p_submission_id: id, p_profession: answers.profession, p_goal: answers.goal, p_commitment: answers.commitment, p_investment: answers.investment });
    expect(registerWebinar).not.toHaveBeenCalled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    syncSheets.mockRejectedValueOnce(new Error());
    const failed = await handleBookingForm(request(answers, { Authorization: `Bearer ${token}` }), "qualification", { persist, syncSheets, env });
    expect(failed.status).toBe(503); expect(await failed.json()).not.toHaveProperty("bookingUrl");
    log.mockRestore();
  });
});
