export const WHATSAPP_CONSENT_TEXT = "Acepto recibir por WhatsApp el seguimiento de esta masterclass y, si reservo una llamada, su confirmación y recordatorios. Puedo darme de baja respondiendo BAJA.";
export const WHATSAPP_CONSENT_VERSION = "2026-10-08-v3";
export const COMMUNICATIONS_CONSENT_TEXT = "Acepto recibir comunicaciones por email de Comunica con Autoridad sobre esta masterclass y sus servicios. Puedo darme de baja en cualquier momento.";
export type LeadField = "name" | "phone" | "email" | "whatsappConsent" | "communicationsConsent" | "profession" | "situation" | "goal" | "commitment" | "investment" | "applicationReasons" | "admissionDecision";
export type LeadFieldErrors = Partial<Record<LeadField, string>>;
export type LeadResponse = { ok: boolean; message: string; fieldErrors?: LeadFieldErrors; accessToken?: string; bookingUrl?: string };
