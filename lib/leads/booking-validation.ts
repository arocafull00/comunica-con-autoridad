import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { leadSchema } from "./validation";
import { ADMISSION_DECISIONS, BOOKING_GOALS, COMMITMENTS, GOALS, INVESTMENTS, SITUATIONS } from "./masterclass";

function requireMobile(value: { phone: string }, context: z.RefinementCtx) {
  const type = parsePhoneNumberFromString(value.phone)?.getType();
  if (type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") {
    context.addIssue({ code: "custom", path: ["phone"], message: "Introduce un número de móvil válido. No se admiten teléfonos fijos." });
  }
}

// Previous first step: email only.
export const accessSchema = z.object({
  email: leadSchema.shape.email,
  communicationsConsent: leadSchema.shape.communicationsConsent,
  website: leadSchema.shape.website,
  utmSource: leadSchema.shape.utmSource,
  utmMedium: leadSchema.shape.utmMedium,
  utmCampaign: leadSchema.shape.utmCampaign,
}).strict();

// "Agendar llamada": name, email and mobile with two independent, optional consents.
export const contactSchema = z.object({
  name: leadSchema.shape.name,
  email: leadSchema.shape.email,
  phone: leadSchema.shape.phone,
  communicationsConsent: leadSchema.shape.communicationsConsent,
  whatsappConsent: z.boolean().default(false),
  website: leadSchema.shape.website,
  utmSource: leadSchema.shape.utmSource,
  utmMedium: leadSchema.shape.utmMedium,
  utmCampaign: leadSchema.shape.utmCampaign,
}).strict().superRefine(requireMobile);

const answers = {
  profession: leadSchema.shape.profession.unwrap(),
  goal: z.enum(BOOKING_GOALS, { error: "Selecciona qué te gustaría mejorar" }),
  commitment: z.enum(COMMITMENTS, { error: "Selecciona tu nivel de compromiso" }),
  investment: z.enum(INVESTMENTS, { error: "Selecciona un rango de inversión" }),
  applicationReasons: z.string({ error: "Explica por qué deberíamos elegir tu candidatura" }).trim()
    .min(1, "Explica por qué deberíamos elegir tu candidatura").max(2000, "Tu respuesta no puede superar los 2000 caracteres"),
  admissionDecision: z.enum(ADMISSION_DECISIONS, { error: "Indica si estás de acuerdo" }),
};

// Previous second step: contact travels with the answers.
export const qualificationSchema = z.object({
  name: leadSchema.shape.name,
  phone: leadSchema.shape.phone,
  ...answers,
}).strict().superRefine(requireMobile);

// Questions after the contact step, including the current situation.
export const candidateQualificationSchema = z.object({
  ...answers,
  situation: z.enum(SITUATIONS, { error: "Selecciona en qué punto te encuentras" }),
}).strict();

export const profileQualificationSchema = z.object({
  profession: answers.profession,
  situation: z.enum(SITUATIONS, { error: "Selecciona tu situación actual" }),
  goal: z.enum(GOALS, { error: "Selecciona qué te gustaría mejorar" }),
}).strict();

export type AccessContact = z.infer<typeof accessSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type Qualification = z.infer<typeof qualificationSchema>;
export type CandidateQualification = z.infer<typeof candidateQualificationSchema>;
