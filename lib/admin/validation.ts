import { z } from "zod";

export const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) });
export const passwordSchema = z.string().min(12).max(128);
// Supabase may prefix opaque token hashes (e.g. PKCE); verification happens at Auth.
export const tokenHashSchema = z.string().min(20).max(512).regex(/^[A-Za-z0-9_-]+$/);
export const settingsSchema = z.object({ revision: z.coerce.number().int().min(0), enabled: z.boolean(), templateId: z.uuid().nullable() });
export function dateRange(start?: string, end?: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const valid = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const last = new Date(`${today}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 1);
  const first = new Date(last); first.setUTCDate(first.getUTCDate() - 30);
  const defaults = { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
  if (!start && !end) return { ...defaults, error: null };
  if (!valid(start) || !valid(end)) return { ...defaults, error: "Selecciona dos fechas válidas." };
  const days = (Date.parse(end!) - Date.parse(start!)) / 86400000;
  if (days < 1 || days > 366) return { ...defaults, error: "El período debe tener entre 1 y 366 días." };
  return { start: start!, end: end!, error: null };
}
