import { describe, expect, it, vi } from "vitest";
import { track } from "@vercel/analytics";
import { redactAnalyticsEvent, trackLeadCreated } from "../../lib/analytics";
import { readLeadAttribution } from "../../lib/leads/attribution";
import { leadSchema } from "../../lib/leads/validation";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

describe("anonymous analytics", () => {
  it.each(["pageview", "event"] as const)("removes queries, fragments and URL credentials from %s", (type) => {
    expect(redactAnalyticsEvent({ type, url: "https://user:password@example.com/?email=private@example.com&utm_source=test#phone" }))
      .toEqual({ type, url: "https://example.com/" });
  });
  it("drops malformed URLs and routes other than the public landing", () => {
    expect(redactAnalyticsEvent({ type: "pageview", url: "bad-url" })).toBeNull();
    expect(redactAnalyticsEvent({ type: "pageview", url: "https://example.com/api/leads" })).toBeNull();
    expect(redactAnalyticsEvent({ type: "pageview", url: "https://example.com/private@example.com" })).toBeNull();
  });
  it("sends a fixed event name without lead properties", () => {
    vi.mocked(track).mockClear();
    trackLeadCreated();
    expect(track).toHaveBeenCalledExactlyOnceWith("lead_submitted");
  });
  it("does not throw if analytics fails", () => {
    vi.mocked(track).mockImplementationOnce(() => { throw new Error("blocked analytics"); });
    expect(trackLeadCreated).not.toThrow();
  });
});

describe("lead campaign attribution", () => {
  it("reads only three UTM labels, without unrelated URL fields", () => {
    expect(readLeadAttribution("?utm_source=instagram&utm_medium=paid&utm_campaign=curso&email=private@example.com"))
      .toEqual({ utmSource: "instagram", utmMedium: "paid", utmCampaign: "curso" });
    expect(readLeadAttribution("")).toEqual({ utmSource: null, utmMedium: null, utmCampaign: null });
  });
  it("normalizes whitespace and bounds untrusted labels", () => {
    expect(readLeadAttribution(`?utm_source=%20%20&utm_medium=%0Atest&utm_campaign=${"x".repeat(500)}`))
      .toEqual({ utmSource: null, utmMedium: "test", utmCampaign: "x".repeat(100) });
  });
  it("accepts legacy clients without attribution and rejects oversized API labels", () => {
    const lead = { name: "Adrián", phone: "612345678", email: "adrian@example.com", whatsappConsent: false };
    expect(leadSchema.parse(lead)).toMatchObject({ utmSource: null, utmMedium: null, utmCampaign: null });
    expect(leadSchema.safeParse({ ...lead, utmSource: "x".repeat(101) }).success).toBe(false);
  });
});
