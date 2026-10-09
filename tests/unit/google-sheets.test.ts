import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GOOGLE_SHEETS_ENDPOINT, saveLeadToGoogleSheets } from "../../lib/leads/google-sheets";
import { leadSchema } from "../../lib/leads/validation";
import { SITUATIONS, GOALS } from "../../lib/leads/masterclass";

const lead = leadSchema.parse({
  name: " Adrián ", phone: "+33 6 12 34 56 78", email: " ADrian@example.com ", whatsappConsent: false,
  profession: "Dirección", situation: SITUATIONS[2], goal: GOALS[0],
});
const key = "f4a211ab-4bc1-4443-a17f-8fa7534153b7";

describe("Google Sheets copy", () => {
  it("uses the existing deployment and the exact field names from the HTML", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, duplicate: false }));
    expect(readFileSync("reference/template.html", "utf8")).toContain(GOOGLE_SHEETS_ENDPOINT);
    await saveLeadToGoogleSheets(lead, key, GOOGLE_SHEETS_ENDPOINT, send);
    expect(send).toHaveBeenCalledTimes(1);
    const [endpoint, init] = send.mock.calls[0];
    expect(endpoint).toBe(GOOGLE_SHEETS_ENDPOINT);
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store" });
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      "form-name": "webinar-leads", submission_id: key, nombre: "Adrián", a_que_te_dedicas: "Dirección",
      situacion_actual: SITUATIONS[2], que_quiere_mejorar: GOALS[0], email: "adrian@example.com",
      telefono: "+33612345678", telefono_pais: "FR", telefono_prefijo: "+33",
      nivel_compromiso: "", rango_inversion: "", razones_para_reservar: "", decision_admision: "",
    });
  });
  it("accepts the Apps Script duplicate acknowledgement on a retry", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, duplicate: true, reason: "email_or_phone" }));
    await expect(saveLeadToGoogleSheets(lead, key, GOOGLE_SHEETS_ENDPOINT, send)).resolves.toBeUndefined();
  });
  it("requires an explicit update acknowledgement for the second phase", async () => {
    const qualified = { ...lead, commitment: "Alto", investment: "Menos de 500€" };
    await expect(saveLeadToGoogleSheets(qualified, key, GOOGLE_SHEETS_ENDPOINT, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, duplicate: true })))).rejects.toThrow("qualification update");
    await expect(saveLeadToGoogleSheets(qualified, key, GOOGLE_SHEETS_ENDPOINT, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, updated: true })))).resolves.toBeUndefined();
  });
  it.each([
    () => Response.json({ success: false }),
    () => Response.json({ success: true }, { status: 503 }),
    () => new Response("<html>Login required</html>", { status: 200 }),
  ])("does not claim success without a confirmed Google Sheets save", async response => {
    await expect(saveLeadToGoogleSheets(lead, key, GOOGLE_SHEETS_ENDPOINT, vi.fn<typeof fetch>().mockResolvedValue(response()))).rejects.toThrow();
  });
});
