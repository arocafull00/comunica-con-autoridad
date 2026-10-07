import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleLeadRequest } from "../../lib/leads/handler";
import { leadSchema } from "../../lib/leads/validation";
import { requestIpHash } from "../../lib/leads/request";
import { SITUATIONS, GOALS } from "../../lib/leads/masterclass";

const valid = { name: "  Adrián  ", phone: "612 345 678", email: " ADrian@example.com ", whatsappConsent: false, website: "" };
const env = { LEAD_IP_HMAC_SECRET: "unit-test-hmac-secret-with-at-least-32-characters" };
function request(body: unknown = valid, key: string = randomUUID(), headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/leads", { method: "POST", headers: {
    "Content-Type": "application/json", "Idempotency-Key": key, ...headers,
  }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("lead validation", () => {
  it("requires every masterclass answer and rejects landlines for masterclass access", () => {
    const profile = { profession: "Dirección", situation: SITUATIONS[2], goal: GOALS[0] };
    expect(leadSchema.safeParse({ ...valid, ...profile }).success).toBe(true);
    expect(leadSchema.safeParse({ ...valid, profession: "Dirección" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...valid, ...profile, goal: "inventado" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...valid, ...profile, phone: "+34911234567" }).success).toBe(false);
  });
  it("normalizes names, emails and Spanish phone numbers", () => {
    expect(leadSchema.parse(valid)).toMatchObject({ name: "Adrián", phone: "+34612345678", email: "adrian@example.com", whatsappConsent: false });
  });
  it("accepts international numbers with an explicit country code", () => {
    expect(leadSchema.parse({ ...valid, phone: "+33 6 12 34 56 78" }).phone).toBe("+33612345678");
  });
  it.each(["123", "llama al 612345678", "+34 612345678 ext. 4"])("rejects invalid/embedded/extension phone %s", (phone) => {
    expect(leadSchema.safeParse({ ...valid, phone }).success).toBe(false);
  });
  it("requires explicit boolean consent and valid email", () => {
    expect(leadSchema.safeParse({ ...valid, whatsappConsent: "true" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...valid, email: "invalid" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...valid, name: "Adrián\nRocafull" }).success).toBe(false);
  });
});

describe("POST /api/leads", () => {
  it("copies validated answers only after Supabase confirms persistence", async () => {
    const submit = vi.fn().mockResolvedValue({ outcome: "created" });
    const syncSheets = vi.fn().mockResolvedValue(undefined);
    const key = randomUUID();
    const response = await handleLeadRequest(request(valid, key), { submit, syncSheets, env });
    expect(response.status).toBe(201);
    expect(syncSheets).toHaveBeenCalledWith(expect.objectContaining({ name: "Adrián", phone: "+34612345678" }), key);
    expect(submit.mock.invocationCallOrder[0]).toBeLessThan(syncSheets.mock.invocationCallOrder[0]);
  });
  it("keeps access locked on a Sheets failure and retries the same submission on replay", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const submit = vi.fn().mockResolvedValueOnce({ outcome: "created" }).mockResolvedValueOnce({ outcome: "replayed" });
    const syncSheets = vi.fn().mockRejectedValueOnce(new Error("private detail")).mockResolvedValueOnce(undefined);
    const key = randomUUID();
    const failed = await handleLeadRequest(request(valid, key), { submit, syncSheets, env });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ ok: false, message: expect.stringContaining("Tus datos están guardados en la web") });
    expect((await handleLeadRequest(request(valid, key), { submit, syncSheets, env })).status).toBe(200);
    expect(syncSheets.mock.calls.map(call => call[1])).toEqual([key, key]);
    log.mockRestore();
  });
  it.each(["conflict", "rate_limited"])("does not copy %s requests into Sheets", async outcome => {
    const syncSheets = vi.fn();
    await handleLeadRequest(request(), { submit: vi.fn().mockResolvedValue({ outcome }), syncSheets, env });
    expect(syncSheets).not.toHaveBeenCalled();
  });
  it("persists the professional answers with the contact in the same submission", async () => {
    const submit = vi.fn().mockResolvedValue({ outcome: "created" });
    const response = await handleLeadRequest(request({ ...valid, profession: " Dirección ", situation: SITUATIONS[2], goal: GOALS[0] }), { submit, env });
    expect(response.status).toBe(201);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ p_profession: "Dirección", p_situation: SITUATIONS[2], p_goal: GOALS[0] }));
  });
  it("passes normalized campaign labels only to protected persistence", async () => {
    const submit = vi.fn().mockResolvedValue({ outcome: "created" });
    const response = await handleLeadRequest(request({ ...valid, utmSource: " instagram ", utmMedium: "paid", utmCampaign: "curso" }), { submit, env });
    expect(response.status).toBe(201);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ p_utm_source: "instagram", p_utm_medium: "paid", p_utm_campaign: "curso" }));
    expect(JSON.stringify(await response.json())).not.toMatch(/instagram|curso/);
  });
  it.each([false, true])("persists consent=%s using normalized fields and HMAC", async (consent) => {
    const submit = vi.fn().mockResolvedValue({ outcome: "created" });
    const response = await handleLeadRequest(request({ ...valid, whatsappConsent: consent }), { submit, env });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ p_phone: "+34612345678", p_whatsapp_consent: consent, p_ip_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each([["replayed", 200], ["conflict", 409], ["rate_limited", 429]] as const)("maps %s to %s", async (outcome, status) => {
    const response = await handleLeadRequest(request(), { submit: vi.fn().mockResolvedValue({ outcome, retry_after: 42 }), env });
    expect(response.status).toBe(status);
    if (status === 429) expect(response.headers.get("retry-after")).toBe("42");
  });
  it("never persists honeypot submissions", async () => {
    const submit = vi.fn();
    expect((await handleLeadRequest(request({ ...valid, website: "spam" }), { submit, env })).status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });
  it("returns errors associated with form fields", async () => {
    const submit = vi.fn();
    const response = await handleLeadRequest(request({ ...valid, phone: "123", email: "x" }), { submit, env });
    expect(await response.json()).toMatchObject({ ok: false, fieldErrors: { phone: expect.any(String), email: expect.any(String) } });
    expect(submit).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON, missing key and wrong content type", async () => {
    const submit = vi.fn();
    for (const req of [request("{"), request(valid, "bad"), request(valid, randomUUID(), { "Content-Type": "text/plain" })]) {
      expect((await handleLeadRequest(req, { submit, env })).status).toBeGreaterThanOrEqual(400);
    }
    expect(submit).not.toHaveBeenCalled();
  });
  it("enforces 8 KB even without a content-length header and with Unicode", async () => {
    const submit = vi.fn();
    expect((await handleLeadRequest(request(JSON.stringify({ name: "á".repeat(5000) })), { submit, env })).status).toBe(413);
    expect(submit).not.toHaveBeenCalled();
  });
  it("returns 503 without claiming persistence succeeded", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleLeadRequest(request(), { submit: vi.fn().mockRejectedValue(new Error("private provider detail")), env });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
    expect(log).toHaveBeenCalledWith("lead_submission_unavailable");
    log.mockRestore();
  });
});

describe("trusted client IP", () => {
  it("ignores spoofed headers outside Vercel", () => {
    const a = requestIpHash(request(valid, randomUUID(), { "x-forwarded-for": "1.1.1.1", "x-vercel-forwarded-for": "2.2.2.2" }), env);
    expect(a).toBe(requestIpHash(request(), env));
  });
  it("uses only the Vercel-managed header under Vercel", () => {
    const vercel = { ...env, VERCEL: "1" };
    expect(() => requestIpHash(request(), vercel)).toThrow();
    expect(() => requestIpHash(request(valid, randomUUID(), { "x-vercel-forwarded-for": "1.1.1.1,2.2.2.2" }), vercel)).toThrow();
    expect(requestIpHash(request(valid, randomUUID(), { "x-vercel-forwarded-for": "1.1.1.1" }), vercel)).not.toBe(requestIpHash(request(), env));
  });
});
