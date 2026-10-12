export const WHATSAPP_CONSENT_TEXT = "Al enviar este formulario, aceptas recibir por WhatsApp tres mensajes de seguimiento de la masterclass, incluida una invitación a reservar. Si reservas una llamada, también recibirás su confirmación y recordatorios. Puedes darte de baja respondiendo BAJA.";
export const WHATSAPP_CONSENT_VERSION = "2026-10-12-v1";
export const COMMUNICATIONS_CONSENT_TEXT = "Acepto recibir comunicaciones por email de Comunica con Autoridad sobre esta masterclass y sus servicios. Puedo darme de baja en cualquier momento.";
export const EMAIL_CONSENT_VERSION = "2026-10-12-v1";
export type LeadField = "name" | "phone" | "email" | "whatsappConsent" | "communicationsConsent" | "profession" | "situation" | "goal" | "commitment" | "investment" | "applicationReasons" | "admissionDecision";
export type LeadFieldErrors = Partial<Record<LeadField, string>>;
export type LeadResponse = { ok: boolean; message: string; fieldErrors?: LeadFieldErrors; accessToken?: string; bookingUrl?: string };
