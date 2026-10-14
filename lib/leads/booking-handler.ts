import { EMAIL_CONSENT_VERSION, WHATSAPP_CHECKBOX_CONSENT_VERSION, WHATSAPP_CONSENT_VERSION, type LeadFieldErrors } from "./contracts";
import { accessSchema, candidateQualificationSchema, contactSchema, qualificationSchema } from "./booking-validation";
import { idempotencySchema } from "./validation";
import { signAccessToken, verifyAccessToken } from "./access-token";
import { BodyTooLargeError, readJsonBody, requestIpHash, type LeadEnvironment } from "./request";
import type { SheetsLead } from "./google-sheets";
import { ADMISSION_DECISIONS, CAL_BOOKING_URL } from "./masterclass";

type Result = { outcome: "created" | "replayed" | "conflict" | "rate_limited" | "missing"; retry_after?: number; lead?: SheetsLead };
// "email" and "qualification" are the previous form; "contact" and "candidate" the current one.
export type BookingFormVariant = "email" | "contact" | "qualification" | "candidate";
type Dependencies = {
  persist: (args: Record<string, unknown>, variant: BookingFormVariant) => Promise<Result>;
  syncSheets: (lead: SheetsLead, submissionId: string) => Promise<void>;
  registerWebinar?: (submissionId: string) => Promise<void>;
  env: LeadEnvironment;
};
const json = (status: number, body: object, headers?: Record<string, string>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const hasAny = (raw: unknown, keys: string[]) => typeof raw === "object" && raw !== null && keys.some(key => key in raw);

export async function handleBookingForm(request: Request, stage: "access" | "qualification", dependencies: Dependencies) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json(415, { ok: false, message: "Envía la solicitud como JSON." });
  }
  try {
    const secret = dependencies.env.LEAD_IP_HMAC_SECRET ?? "";
    const id = stage === "access"
      ? idempotencySchema.safeParse(request.headers.get("idempotency-key")).data?.toLowerCase()
      : verifyAccessToken(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", secret);
    if (!id) return json(stage === "access" ? 400 : 401, { ok: false, message: "Completa tus datos de acceso para continuar." });
    let raw: unknown;
    try { raw = await readJsonBody(request); }
    catch (error) {
      return json(error instanceof BodyTooLargeError ? 413 : 400, { ok: false, message: "La solicitud no tiene un formato válido." });
    }
    // The current form sends the contact first; earlier pages send name and mobile with the answers.
    const variant: BookingFormVariant = stage === "access"
      ? hasAny(raw, ["name", "phone", "whatsappConsent"]) ? "contact" : "email"
      : hasAny(raw, ["situation"]) && !hasAny(raw, ["name", "phone"]) ? "candidate" : "qualification";
    const schema = { email: accessSchema, contact: contactSchema, qualification: qualificationSchema, candidate: candidateQualificationSchema }[variant];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors: LeadFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof LeadFieldErrors;
        if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
      }
      const outdatedForm = variant === "qualification" && !hasAny(raw, ["applicationReasons", "admissionDecision"])
        && parsed.error.issues.every(issue => ["name", "phone", "applicationReasons", "admissionDecision"].includes(String(issue.path[0])));
      return json(400, { ok: false, message: outdatedForm
        ? "El formulario se ha actualizado. Recarga la página y completa tus datos y las preguntas para reservar tu llamada."
        : "Revisa los datos del formulario.", fieldErrors });
    }
    let args: Record<string, unknown>;
    let admissionDecision: string | undefined;
    if (variant === "email" || variant === "contact") {
      const details = variant === "contact" ? contactSchema.parse(parsed.data) : null;
      const contact = details ?? accessSchema.parse(parsed.data);
      if (contact.website) return json(400, { ok: false, message: "No se ha podido enviar la solicitud." });
      const common = { p_idempotency_key: id, p_email: contact.email, p_communications_consent: contact.communicationsConsent,
        p_ip_hash: requestIpHash(request, dependencies.env),
        p_utm_source: contact.utmSource, p_utm_medium: contact.utmMedium, p_utm_campaign: contact.utmCampaign };
      args = details
        ? { ...common, p_name: details.name, p_phone: details.phone, p_whatsapp_consent: details.whatsappConsent,
          p_email_consent_version: EMAIL_CONSENT_VERSION, p_whatsapp_consent_version: WHATSAPP_CHECKBOX_CONSENT_VERSION }
        : { ...common, p_consent_version: EMAIL_CONSENT_VERSION };
    } else if (variant === "qualification") {
      const answers = qualificationSchema.parse(parsed.data);
      admissionDecision = answers.admissionDecision;
      args = { p_submission_id: id, p_name: answers.name, p_phone: answers.phone,
        p_whatsapp_consent_version: WHATSAPP_CONSENT_VERSION, p_profession: answers.profession, p_goal: answers.goal,
        p_commitment: answers.commitment, p_investment: answers.investment,
        p_application_reasons: answers.applicationReasons, p_admission_decision: answers.admissionDecision };
    } else {
      const answers = candidateQualificationSchema.parse(parsed.data);
      admissionDecision = answers.admissionDecision;
      args = { p_submission_id: id, p_profession: answers.profession, p_situation: answers.situation, p_goal: answers.goal,
        p_commitment: answers.commitment, p_investment: answers.investment,
        p_application_reasons: answers.applicationReasons, p_admission_decision: answers.admissionDecision };
    }
    const result = await dependencies.persist(args, variant);
    if (result.outcome === "conflict") return json(409, { ok: false, message: "Esta inscripción ya contiene otros datos. Realiza otra inscripción si necesitas cambiarlos." });
    if (result.outcome === "missing") return json(401, { ok: false, message: "Completa tus datos de acceso para continuar." });
    if (result.outcome === "rate_limited") return json(429, { ok: false, message: "Espera unos minutos antes de volver a intentarlo." }, { "Retry-After": String(result.retry_after ?? 600) });
    if (!["created", "replayed"].includes(result.outcome) || !result.lead) throw new Error("Invalid persistence response");
    if (stage === "access") {
      // The contact RPC registers and schedules in its own transaction.
      if (variant === "email") await dependencies.registerWebinar?.(id);
      return json(result.outcome === "created" ? 201 : 200, { ok: true, message: variant === "email" ? "Tu acceso está listo." : "Tus datos están guardados.", accessToken: signAccessToken(id, secret) });
    }
    await dependencies.syncSheets(result.lead, id);
    return json(200, { ok: true, message: "Tus respuestas están guardadas.",
      ...(admissionDecision === ADMISSION_DECISIONS[0] ? { bookingUrl: CAL_BOOKING_URL } : {}) });
  } catch {
    console.error("masterclass_form_unavailable");
    return json(503, { ok: false, message: "No hemos podido confirmar el guardado. Tus datos siguen aquí; vuelve a intentarlo." });
  }
}
