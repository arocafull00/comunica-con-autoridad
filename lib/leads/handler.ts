import { idempotencySchema, leadSchema } from "./validation";
import { WHATSAPP_CONSENT_VERSION, type LeadField, type LeadFieldErrors } from "./contracts";
import { BodyTooLargeError, readJsonBody, requestIpHash, type LeadEnvironment } from "./request";
import type { ValidatedLead } from "./google-sheets";

type SubmissionResult = { outcome: "created" | "replayed" | "conflict" | "rate_limited"; retry_after?: number };
type Dependencies = {
  submit: (args: Record<string, unknown>) => Promise<SubmissionResult>;
  syncSheets?: (lead: ValidatedLead, submissionId: string) => Promise<void>;
  registerWebinar?: (submissionId: string) => Promise<void>;
  env: LeadEnvironment;
};

export async function handleLeadRequest(request: Request, dependencies: Dependencies): Promise<Response> {
  const json = (status: number, body: object, headers?: Record<string, string>) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json(415, { ok: false, message: "Envía la solicitud como JSON." });
  }
  const key = idempotencySchema.safeParse(request.headers.get("idempotency-key"));
  if (!key.success) return json(400, { ok: false, message: "La solicitud no tiene un identificador válido." });
  let raw: unknown;
  try { raw = await readJsonBody(request); }
  catch (error) { return json(error instanceof BodyTooLargeError ? 413 : 400, { ok: false, message: "La solicitud no tiene un formato válido." }); }
  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: LeadFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as LeadField;
      if (["name", "phone", "email", "whatsappConsent", "communicationsConsent", "profession", "situation", "goal"].includes(field) && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return json(400, { ok: false, message: "Revisa los datos del formulario.", fieldErrors });
  }
  if (parsed.data.website) return json(400, { ok: false, message: "No se ha podido enviar la solicitud." });
  try {
    const result = await dependencies.submit({
      p_idempotency_key: key.data.toLowerCase(), p_name: parsed.data.name, p_phone: parsed.data.phone,
      p_email: parsed.data.email, p_whatsapp_consent: parsed.data.whatsappConsent,
      p_consent_version: WHATSAPP_CONSENT_VERSION, p_ip_hash: requestIpHash(request, dependencies.env),
      p_communications_consent: parsed.data.communicationsConsent,
      p_utm_source: parsed.data.utmSource, p_utm_medium: parsed.data.utmMedium, p_utm_campaign: parsed.data.utmCampaign,
      p_profession: parsed.data.profession ?? null, p_situation: parsed.data.situation ?? null, p_goal: parsed.data.goal ?? null,
    });
    switch (result.outcome) {
      case "created": case "replayed": {
        try {
          await dependencies.syncSheets?.(parsed.data, key.data.toLowerCase());
        } catch {
          console.error("lead_google_sheets_unavailable");
          return json(503, {
            ok: false,
            message: "Tus datos están guardados en la web, pero no hemos podido confirmar la copia en Google Sheets. Vuelve a intentarlo para completar el acceso.",
          });
        }
        // A completed form becomes a registration when access can actually be granted.
        // Retrying after either persistence failure must not restart the sequence.
        if (parsed.data.profession && parsed.data.situation && parsed.data.goal) {
          await dependencies.registerWebinar?.(key.data.toLowerCase());
        }
        return json(result.outcome === "created" ? 201 : 200, {
          ok: true, message: "Gracias, hemos recibido tu solicitud. Nos pondremos en contacto contigo próximamente.",
        });
      }
      case "conflict": return json(409, { ok: false, message: "Estos datos son distintos a los de una solicitud ya recibida. Vuelve a enviarlos como una nueva solicitud." });
      case "rate_limited": return json(429, { ok: false, message: "Has enviado varias solicitudes. Espera unos minutos antes de volver a intentarlo." }, { "Retry-After": String(result.retry_after ?? 600) });
      default: throw new Error("Invalid persistence response");
    }
  } catch {
    console.error("lead_submission_unavailable");
    return json(503, { ok: false, message: "No hemos podido guardar tu solicitud. Tus datos siguen aquí; vuelve a intentarlo." });
  }
}
