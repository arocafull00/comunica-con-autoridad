import { describe, expect, it } from "vitest";
import { dateRange, passwordSchema, settingsSchema } from "../../lib/admin/validation";
import { madridMidnight, queryTraffic } from "../../lib/admin/traffic";
import { catalogTemplates, fetchTemplates } from "../../supabase/functions/_shared/meta-templates";

describe("admin dates and configuration", () => {
  it("uses Madrid calendar days even when UTC is the previous day", () => {
    expect(dateRange(undefined, undefined, new Date("2026-10-06T23:30:00Z"))).toEqual({ start: "2026-09-08", end: "2026-10-08", error: null });
  });
  it("rejects impossible dates and reversed or oversized intervals", () => {
    for (const [start, end] of [["2026-02-30", "2026-03-02"], ["2026-10-08", "2026-10-07"], ["2025-01-01", "2026-10-07"]]) expect(dateRange(start, end).error).toBeTruthy();
  });
  it("converts the spring DST day to a 23-hour interval", () => {
    expect(madridMidnight("2026-03-29")).toBe("2026-03-28T23:00:00.000Z");
    expect(madridMidnight("2026-03-30")).toBe("2026-03-29T22:00:00.000Z");
  });
  it("validates revision, template UUID and password length", () => {
    expect(settingsSchema.safeParse({ revision: "0", enabled: false, templateId: null }).success).toBe(true);
    expect(settingsSchema.safeParse({ revision: -1, enabled: true, templateId: "bad" }).success).toBe(false);
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("a-long-password-123").success).toBe(true);
  });
});
describe("private Vercel traffic query", () => {
  const range = { start: "2026-03-29", end: "2026-03-30" };
  it("does not query when unconfigured or invent zero visitors", async () => {
    expect(await queryTraffic(range, {}, async () => { throw new Error("Must not call"); })).toMatchObject({ available: false });
  });
  it("requests totals for the production landing over the Madrid interval", async () => {
    const result = await queryTraffic(range, { token: "private-token", projectId: "project", teamId: "team" }, async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.vercel.com");
      expect(url.searchParams.get("by")).toBe("requestPath");
      expect(url.searchParams.get("since")).toBe("2026-03-28T23:00:00.000Z");
      expect(url.searchParams.get("until")).toBe("2026-03-29T21:59:59.999Z");
      expect(url.searchParams.get("filter")).toBe("requestPath eq '/' and environment eq 'production'");
      expect(init?.headers).toEqual({ Authorization: "Bearer private-token" });
      expect(init?.cache).toBe("no-store");
      return Response.json({ data: [{ requestPath: "/", visitors: 20, pageviews: 30 }] });
    });
    expect(result).toEqual({ available: true, visitors: 20, pageviews: 30 });
  });
  it("handles provider failure, timeout and incompatible responses without leaking details", async () => {
    for (const fetcher of [async () => Response.json({ error: "private-token" }, { status: 403 }), async () => { throw new Error("private-token"); }, async () => Response.json({ data: [{ visitors: 5, pageviews: 5 }, { visitors: 2, pageviews: 2 }] })]) {
      const result = await queryTraffic(range, { token: "private-token", projectId: "project" }, fetcher);
      expect(result.available).toBe(false);
      expect(JSON.stringify(result)).not.toContain("private-token");
    }
  });
});
describe("complete WhatsApp catalog", () => {
  const template = { name: "welcome", language: "es", status: "APPROVED", components: [{ type: "BODY", text: "Hola {{1}}, recibimos tu solicitud." }] };
  it("retains every status and format while limiting welcome sends to compatible approved templates", () => {
    const input = [template, { ...template, status: "PENDING" }, { ...template, status: "REJECTED" }, { ...template, status: "PAUSED" }, { ...template, components: [{ type: "BODY", text: "Hola {{1}} {{2}}" }] }, { ...template, components: [{ type: "BODY", text: "Hola {{name}}" }] }, { ...template, components: [...template.components, { type: "HEADER", text: "Cabecera" }] }, { ...template, parameter_format: "NAMED" }, { ...template, components: [{ type: "HEADER" }] }];
    const catalog = catalogTemplates(input);
    expect(catalog).toHaveLength(input.length);
    expect(catalog.map((t) => t.approved)).toEqual([true, false, false, false, false, false, false, false, false]);
    expect(catalog.map((t) => t.meta_status)).toEqual(input.map((t) => t.status));
    expect(catalog[6].components).toEqual(input[6].components);
    expect(catalog[8].body).toBe("");
  });
  it("rejects malformed catalogs rather than withdrawing existing entries after a partial import", () => {
    expect(() => catalogTemplates([template, { ...template, name: "Bad name" }])).toThrow();
  });
  it("paginates only against Meta with authorization in headers", async () => {
    let calls = 0;
    const result = await fetchTemplates({ token: "secret", wabaId: "123", version: "v99.0" }, async (input: URL | RequestInfo) => {
      const url = new URL(String(input)); calls++;
      expect(url.origin).toBe("https://graph.facebook.com");
      expect(url.searchParams.has("access_token")).toBe(false);
      if (calls === 1) return Response.json({ data: [], paging: { next: "https://untrusted.invalid", cursors: { after: "cursor" } } });
      expect(url.searchParams.get("after")).toBe("cursor");
      return Response.json({ data: [template, { ...template, name: "pending", status: "PENDING" }] });
    });
    expect(calls).toBe(2); expect(result).toHaveLength(2);
  });
});
