import { bookingSubmissionSchema } from "@/lib/leads/booking-validation";
import type { LeadFieldErrors, LeadResponse } from "@/lib/leads/contracts";
import { saveLeadToGoogleSheets } from "@/lib/leads/google-sheets";
import { CAL_BOOKING_URL } from "@/lib/leads/masterclass";
import { BodyTooLargeError, readJsonBody } from "@/lib/leads/request";
import { idempotencySchema } from "@/lib/leads/validation";

function json(status: number, body: LeadResponse) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return json(415, { ok: false, message: "Envía la solicitud como JSON." });

  const id = idempotencySchema.safeParse(request.headers.get("idempotency-key"));
  if (!id.success) return json(400, { ok: false, message: "Recarga la página y vuelve a rellenar el formulario." });

  let raw: unknown;
  try {
    raw = await readJsonBody(request);
  } catch (error) {
    return json(error instanceof BodyTooLargeError ? 413 : 400, { ok: false, message: "La solicitud no tiene un formato válido." });
  }

  const submission = bookingSubmissionSchema.safeParse(raw);
  if (!submission.success) {
    const fieldErrors: LeadFieldErrors = {};
    for (const issue of submission.error.issues) {
      const field = issue.path[0] as keyof LeadFieldErrors | undefined;
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return json(400, { ok: false, message: "Revisa los datos del formulario.", fieldErrors });
  }
  if (submission.data.website) return json(400, { ok: false, message: "No se ha podido enviar la solicitud." });

  try {
    const { name, email, phone, profession, situation, goal } = submission.data;
    await saveLeadToGoogleSheets({ name, email, phone, profession, situation, goal }, id.data.toLowerCase());
    return json(200, { ok: true, message: "Tus respuestas están guardadas.", bookingUrl: CAL_BOOKING_URL });
  } catch {
    console.error("masterclass_google_sheets_unavailable");
    return json(503, { ok: false, message: "No hemos podido confirmar el guardado. Tus datos siguen aquí; vuelve a intentarlo." });
  }
}
