import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { z } from "zod";
import { SITUATIONS, GOALS } from "./masterclass";

const attributionValue = z.string().trim().max(100).refine((value) => !/[\x00-\x1f\x7f]/.test(value))
  .nullable().optional().transform((value) => value || null);

export const leadSchema = z.object({
  name: z.string().trim().min(2, "Introduce tu nombre").max(100, "El nombre es demasiado largo")
    .refine((value) => !/[\r\n\t]/.test(value), "Introduce el nombre en una sola línea"),
  phone: z.string().trim().max(40).transform((value, context) => {
    const phone = parsePhoneNumberFromString(value, { defaultCountry: "ES", extract: false });
    if (!phone?.isValid() || phone.ext) {
      context.addIssue({ code: "custom", message: "Introduce un teléfono válido; incluye el prefijo si es de otro país" });
      return z.NEVER;
    }
    return phone.number;
  }),
  email: z.string().trim().max(254).pipe(z.email("Introduce un email válido")).transform((value) => value.toLowerCase()),
  whatsappConsent: z.boolean(),
  communicationsConsent: z.boolean().default(false),
  profession: z.string().trim().min(1, "Completa tu profesión o actividad").max(200)
    .refine((value) => !/[\r\n\t]/.test(value), "Introduce tu actividad en una sola línea").optional(),
  situation: z.enum(SITUATIONS, { error: "Selecciona tu situación actual" }).optional(),
  goal: z.enum(GOALS, { error: "Selecciona qué te gustaría mejorar" }).optional(),
  website: z.string().max(200).default(""),
  utmSource: attributionValue,
  utmMedium: attributionValue,
  utmCampaign: attributionValue,
}).strict().superRefine((value, context) => {
  if (value.profession !== undefined || value.situation !== undefined || value.goal !== undefined) {
    for (const field of ["profession", "situation", "goal"] as const) {
      if (!value[field]) context.addIssue({ code: "custom", path: [field], message: "Completa esta pregunta para continuar" });
    }
    const type = parsePhoneNumberFromString(value.phone)?.getType();
    if (type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") {
      context.addIssue({ code: "custom", path: ["phone"], message: "Introduce un número de móvil válido. No se admiten teléfonos fijos." });
    }
  }
});
export const idempotencySchema = z.uuid();
