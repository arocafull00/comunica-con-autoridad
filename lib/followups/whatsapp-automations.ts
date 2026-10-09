export const whatsappAutomations = [
  { key: "booking_confirmation", title: "Confirmación de reserva", group: "booking", trigger: "Al reservar con 24 horas o más de antelación" },
  { key: "booking_short_notice", title: "Reserva con menos de 24 horas", group: "booking", trigger: "Al reservar entre 2 y menos de 24 horas antes" },
  { key: "booking_24h", title: "Recordatorio de 24 horas", group: "booking", trigger: "24 horas antes de la llamada" },
  { key: "booking_2h", title: "Recordatorio de 2 horas", group: "booking", trigger: "2 horas antes · incluye el enlace de Meet" },
  { key: "booking_15m", title: "Recordatorio de 15 minutos", group: "booking", trigger: "15 minutos antes · también para reservas a menos de 2 horas" },
  { key: "webinar_1h", title: "Seguimiento de la clase", group: "webinar", trigger: "1 minuto después de apuntarse · si no ha reservado" },
  { key: "webinar_1d", title: "Invitación a reservar", group: "webinar", trigger: "3 minutos después de apuntarse · si no ha reservado" },
  { key: "webinar_3d", title: "Cierre del seguimiento", group: "webinar", trigger: "5 minutos después · si no ha reservado ni respondido" },
] as const;

export const fixedWhatsappTemplates = {
  booking_confirmation: { name: "whatsapp_confirmacion_reserva", language: "es" },
  booking_short_notice: { name: "reserva_menos_24hantes", language: "en" },
  booking_24h: { name: "recordatorio_24hantes", language: "en" },
  booking_2h: { name: "recordatorio_reunion_2h", language: "es" },
  booking_15m: { name: "15_minutos_antes", language: "en" },
  webinar_1h: { name: "seguimiento_webinar_1h", language: "es" },
  webinar_1d: { name: "no_reservan_1dia_despues", language: "es" },
  webinar_3d: { name: "seguimiento_no_reserva_3dia", language: "en" },
} as const;

export type WhatsappAutomation = {
  key: string; body: string; parameter: "name" | "meetingUrl" | null;
  template_name: string | null; language: string | null; meta_status: string | null; ready: boolean;
  components: import("../whatsapp-template-compatibility").MetaTemplateComponent[];
};

export function whatsappJobStatus(status: string, error: string | null) {
  if (status === "suppressed") {
    if (["not_needed_short_notice", "not_needed_variant", "reminder_time_elapsed"].includes(error ?? "")) return "No ha hecho falta";
    const reasons: Record<string, string> = { call_already_booked: "Ya ha reservado", contact_replied: "Ya ha respondido", booking_changed: "Reserva cancelada o reprogramada", consent_missing: "Sin consentimiento", schedule_expired: "Horario vencido", automation_content_changed: "El mensaje anterior ha cambiado" };
    return reasons[error ?? ""] ?? "Omitido";
  }
  return ({ pending: "Pendiente", processing: "Procesando", sent: "Aceptado por Meta", failed: error === "delivery_unknown" ? "Resultado incierto · revisión manual" : "Fallido" } as Record<string, string>)[status] ?? status;
}
