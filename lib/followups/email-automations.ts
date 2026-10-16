export const emailAutomations = [
  { key: "email_1", title: "Email 1 · Claridad", template: "email-1-claridad", trigger: "30 minutos después de la inscripción con email" },
  { key: "email_2", title: "Email 2 · Casos", template: "email-2-casos", trigger: "1 día después de la inscripción con email" },
  { key: "email_3", title: "Email 3 · Empezar", template: "email-3-empezar", trigger: "2 días después de la inscripción con email" },
  { key: "email_4", title: "Email 4 · Resultados", template: "email-4-resultados", trigger: "3 días después de la inscripción con email" },
] as const;

export function emailStepTitle(step: string) {
  return emailAutomations.find((definition) => definition.key === step)?.title ?? step;
}

export function emailJobStatus(status: string, error: string | null) {
  if (status === "suppressed") {
    const reasons: Record<string, string> = { email_unsubscribed: "Se ha dado de baja", email_consent_missing: "Sin consentimiento o dado de baja", schedule_expired: "Horario vencido" };
    return reasons[error ?? ""] ?? "Omitido";
  }
  return ({ pending: "Pendiente", processing: "Procesando", sent: "Aceptado por Resend", failed: error === "delivery_unknown" ? "Resultado incierto · revisión manual" : "Fallido" } as Record<string, string>)[status] ?? status;
}

export function emailJobError(error: string | null) {
  if (!error) return null;
  const errors: Record<string, string> = {
    email_configuration_missing: "El envío de emails no está configurado en el worker",
    email_template_missing: "No hay plantilla de Resend para este paso",
    delivery_unknown: "Sin respuesta clara de Resend",
    attempts_exhausted: "Se agotaron los reintentos",
    email_unsubscribed: "Baja confirmada desde el email",
    email_consent_missing: "Sin consentimiento de email o con baja",
  };
  return errors[error] ?? (error.startsWith("resend_http_") ? `Resend rechazó el envío (HTTP ${error.slice(12)})` : error);
}
