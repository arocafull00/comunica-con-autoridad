import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { leadSchema } from "./validation";
import { BOOKING_GOALS, COMMITMENTS, INVESTMENTS } from "./masterclass";

export const accessSchema = z.object({
  phone: leadSchema.shape.phone,
  email: leadSchema.shape.email,
  whatsappConsent: leadSchema.shape.whatsappConsent,
  communicationsConsent: leadSchema.shape.communicationsConsent,
  website: leadSchema.shape.website,
  utmSource: leadSchema.shape.utmSource,
  utmMedium: leadSchema.shape.utmMedium,
  utmCampaign: leadSchema.shape.utmCampaign,
}).strict().superRefine((value, context) => {
  const type = parsePhoneNumberFromString(value.phone)?.getType();
  if (type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") {
    context.addIssue({ code: "custom", path: ["phone"], message: "Introduce un número de móvil válido. No se admiten teléfonos fijos." });
  }
});

export const qualificationSchema = z.object({
  profession: leadSchema.shape.profession.unwrap(),
  goal: z.enum(BOOKING_GOALS, { error: "Selecciona qué te gustaría mejorar" }),
  commitment: z.enum(COMMITMENTS, { error: "Selecciona tu nivel de compromiso" }),
  investment: z.enum(INVESTMENTS, { error: "Selecciona un rango de inversión" }),
}).strict();

export type AccessContact = z.infer<typeof accessSchema>;
export type Qualification = z.infer<typeof qualificationSchema>;
