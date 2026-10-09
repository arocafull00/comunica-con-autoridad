import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { z } from "zod";
import type { leadSchema } from "./validation";
import type { AccessContact } from "./booking-validation";

// Existing Apps Script deployment from reference/template.html.
export const GOOGLE_SHEETS_ENDPOINT = "https://script.google.com/macros/s/AKfycbzh1bOTGWIBIxu4EeY1kjmBMsvlSLja11cp5WCr0FbW5sP6ivwHlmFs7_AaEVrRarHg/exec";
export type ValidatedLead = z.infer<typeof leadSchema>;
export type SheetsLead = Pick<AccessContact, "phone" | "email"> & {
  name?: string | null; profession?: string | null; situation?: string | null; goal?: string | null;
  commitment?: string | null; investment?: string | null;
  applicationReasons?: string | null; admissionDecision?: string | null;
};

export async function saveLeadToGoogleSheets(
  lead: SheetsLead,
  submissionId: string,
  endpoint = process.env.GOOGLE_SHEETS_ENDPOINT || GOOGLE_SHEETS_ENDPOINT,
  send: typeof fetch = fetch,
) {
  const phone = parsePhoneNumberFromString(lead.phone);
  const body = new URLSearchParams({
    "form-name": "webinar-leads",
    submission_id: submissionId,
    nombre: lead.name ?? "",
    a_que_te_dedicas: lead.profession ?? "",
    situacion_actual: lead.situation ?? "",
    que_quiere_mejorar: lead.goal ?? "",
    nivel_compromiso: lead.commitment ?? "",
    rango_inversion: lead.investment ?? "",
    razones_para_reservar: lead.applicationReasons ?? "",
    decision_admision: lead.admissionDecision ?? "",
    email: lead.email,
    telefono: lead.phone,
    telefono_pais: phone?.country ?? "",
    telefono_prefijo: phone ? `+${phone.countryCallingCode}` : "",
  });
  const response = await send(endpoint, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(), signal: AbortSignal.timeout(10_000), cache: "no-store",
  });
  if (!response.ok) throw new Error("Google Sheets request failed");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("success" in result) || result.success !== true) {
    throw new Error("Google Sheets did not confirm persistence");
  }
  // A legacy duplicate acknowledgement does not prove that the new answers were saved.
  if (lead.commitment && (!("updated" in result) || result.updated !== true)) {
    throw new Error("Google Sheets did not confirm qualification update");
  }
}
