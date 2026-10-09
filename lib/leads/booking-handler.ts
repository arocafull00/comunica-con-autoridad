import { WHATSAPP_CONSENT_VERSION, type LeadFieldErrors } from "./contracts";
import { accessSchema, qualificationSchema } from "./booking-validation";
import { idempotencySchema } from "./validation";
import { signAccessToken, verifyAccessToken } from "./access-token";
import { BodyTooLargeError, readJsonBody, requestIpHash, type LeadEnvironment } from "./request";
import type { SheetsLead } from "./google-sheets";
import { CAL_BOOKING_URL } from "./masterclass";

type Result = { outcome: "created" | "replayed" | "conflict" | "rate_limited" | "missing"; retry_after?: number; lead?: SheetsLead };
type Dependencies = {
  persist: (args: Record<string, unknown>) => Promise<Result>;
  syncSheets: (lead: SheetsLead, submissionId: string) => Promise<void>;
  registerWebinar?: (submissionId: string) => Promise<void>;
  env: LeadEnvironment;
};
const json = (status: number, body: object, headers?: Record<string, string>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

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
    const parsed = stage === "access" ? accessSchema.safeParse(raw) : qualificationSchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors: LeadFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof LeadFieldErrors;
        if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
      }
      return json(400, { ok: false, message: "Revisa los datos del formulario.", fieldErrors });
    }
    let args: Record<string, unknown>;
    if (stage === "access") {
      const contact = accessSchema.parse(parsed.data);
      if (contact.website) return json(400, { ok: false, message: "No se ha podido enviar la solicitud." });
      args = { p_idempotency_key: id, p_phone: contact.phone, p_email: contact.email,
        p_whatsapp_consent: contact.whatsappConsent, p_communications_consent: contact.communicationsConsent,
        p_consent_version: WHATSAPP_CONSENT_VERSION, p_ip_hash: requestIpHash(request, dependencies.env),
        p_utm_source: contact.utmSource, p_utm_medium: contact.utmMedium, p_utm_campaign: contact.utmCampaign };
    } else {
      const answers = qualificationSchema.parse(parsed.data);
      args = { p_submission_id: id, p_profession: answers.profession, p_goal: answers.goal,
        p_commitment: answers.commitment, p_investment: answers.investment,
        p_application_reasons: answers.applicationReasons, p_admission_decision: answers.admissionDecision };
    }
    const result = await dependencies.persist(args);
    if (result.outcome === "conflict") return json(409, { ok: false, message: "Esta inscripción ya contiene otros datos. Realiza otra inscripción si necesitas cambiarlos." });
    if (result.outcome === "missing") return json(401, { ok: false, message: "Completa tus datos de acceso para continuar." });
    if (result.outcome === "rate_limited") return json(429, { ok: false, message: "Espera unos minutos antes de volver a intentarlo." }, { "Retry-After": String(result.retry_after ?? 600) });
    if (!["created", "replayed"].includes(result.outcome) || !result.lead) throw new Error("Invalid persistence response");
    await dependencies.syncSheets(result.lead, id);
    if (stage === "access") {
      await dependencies.registerWebinar?.(id);
      return json(result.outcome === "created" ? 201 : 200, { ok: true, message: "Tu acceso está listo.", accessToken: signAccessToken(id, secret) });
    }
    return json(200, { ok: true, message: "Tus respuestas están guardadas.", bookingUrl: CAL_BOOKING_URL });
  } catch {
    console.error("masterclass_form_unavailable");
    return json(503, { ok: false, message: "No hemos podido confirmar el guardado. Tus datos siguen aquí; vuelve a intentarlo." });
  }
}
