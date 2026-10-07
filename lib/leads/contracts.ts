export const WHATSAPP_CONSENT_TEXT = "Acepto que Comunica con Autoridad me envíe por WhatsApp una confirmación de mi solicitud";
export const WHATSAPP_CONSENT_VERSION = "2026-10-06-v1";
export type LeadField = "name" | "phone" | "email" | "whatsappConsent" | "profession" | "situation" | "goal";
export type LeadFieldErrors = Partial<Record<LeadField, string>>;
export type LeadResponse = { ok: boolean; message: string; fieldErrors?: LeadFieldErrors };
