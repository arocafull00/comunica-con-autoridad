export const whatsappAutomations = [
  { key: "booking_ok_request", title: "Reserva recibida · botón OK", group: "booking", trigger: "Al reservar con 24 horas o más de antelación · flujo con audios", variables: ["[Nombre del registro]", "[Fecha de la reunión]", "[Hora local del cliente]", "[Enlace de Meet]"] },
  { key: "booking_confirm_request", title: "Petición de confirmación · botón CONFIRMAR", group: "booking", trigger: "2 horas después de que Meta acepte el primer audio · si aún no ha confirmado", variables: ["[Nombre del registro]", "[Enlace de Meet]"] },
  { key: "booking_confirmation", title: "Confirmación de reserva", group: "booking", trigger: "Al reservar con 24 horas o más de antelación · reservas sin el flujo con audios" },
  { key: "booking_short_notice", title: "Reserva con menos de 24 horas", group: "booking", trigger: "Al reservar entre 2 y menos de 24 horas antes" },
  { key: "booking_24h", title: "Recordatorio de 24 horas", group: "booking", trigger: "24 horas antes de la llamada · reservas sin el flujo con audios" },
  { key: "booking_2h", title: "Recordatorio de 2 horas", group: "booking", trigger: "2 horas antes · incluye el enlace de Meet" },
  { key: "booking_15m", title: "Recordatorio de 15 minutos", group: "booking", trigger: "15 minutos antes · también para reservas a menos de 2 horas" },
  { key: "webinar_1h", title: "Seguimiento de la clase", group: "webinar", trigger: "1 hora después de guardar el contacto · si no ha reservado" },
  { key: "webinar_1d", title: "Invitación a reservar", group: "webinar", trigger: "1 día después de guardar el contacto · si no ha reservado" },
  { key: "webinar_3d", title: "Cierre del seguimiento", group: "webinar", trigger: "3 días después de guardar el contacto · si no ha reservado ni respondido" },
] as const;

// Recorded audios sent as WhatsApp audio messages. They need no Meta template, only an open 24-hour window.
export const whatsappAudioSteps = [
  { key: "booking_audio_1", title: "Primer audio de Ignacio", trigger: "Al recibir OK de la reserva vigente · una sola vez" },
  { key: "booking_audio_2", title: "Segundo audio de Ignacio", trigger: "2 horas antes · solo con OK recibido y ventana de respuesta abierta" },
] as const;

export const fixedWhatsappTemplates = {
  booking_ok_request: { name: "reserva_recibida_ok", language: "es" },
  booking_confirm_request: { name: "reserva_confirmar_asistencia", language: "es" },
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

export function whatsappStepTitle(step: string) {
  return [...whatsappAutomations, ...whatsappAudioSteps].find((definition) => definition.key === step)?.title ?? step;
}

export function whatsappJobStatus(status: string, error: string | null) {
  if (status === "suppressed") {
    if (["not_needed_short_notice", "not_needed_variant", "reminder_time_elapsed"].includes(error ?? "")) return "No ha hecho falta";
    const reasons: Record<string, string> = { call_already_booked: "Ya ha reservado", contact_replied: "Ya ha respondido", booking_changed: "Reserva cancelada o reprogramada", consent_missing: "Sin consentimiento", schedule_expired: "Horario vencido", automation_content_changed: "El mensaje anterior ha cambiado",
      whatsapp_window_closed: "Omitido · ventana de 24 horas cerrada", ok_not_received: "Omitido · sin OK", already_confirmed: "Omitido · ya confirmada", call_started: "Omitido · la llamada ya había empezado" };
    return reasons[error ?? ""] ?? "Omitido";
  }
  return ({ pending: "Pendiente", processing: "Procesando", sent: "Aceptado por Meta", failed: error === "delivery_unknown" ? "Resultado incierto · revisión manual" : "Fallido" } as Record<string, string>)[status] ?? status;
}
