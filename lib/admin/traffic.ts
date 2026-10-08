import { z } from "zod";

export function madridMidnight(date: string) {
  const utc = new Date(`${date}T00:00:00.000Z`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(utc));
  return new Date(utc.getTime() - hour * 3600000).toISOString();
}
const counts = z.object({ pageviews: z.number().nonnegative(), visitors: z.number().nonnegative() });
export type TrafficResult = { available: true; pageviews: number; visitors: number } | { available: false; reason: string };
export async function queryTraffic(range: { start: string; end: string }, config: { token?: string; projectId?: string; teamId?: string }, fetcher: typeof fetch = fetch): Promise<TrafficResult> {
  if (!config.token || !config.projectId) return { available: false, reason: "La consulta de visitas desde este panel todavía no está configurada." };
  try {
    const url = new URL("https://api.vercel.com/v1/query/web-analytics/visits/aggregate");
    url.searchParams.set("projectId", config.projectId);
    if (config.teamId) url.searchParams.set("teamId", config.teamId);
    // Filtering to one path yields a single total, without summing daily unique visitors.
    url.searchParams.set("by", "requestPath");
    url.searchParams.set("since", madridMidnight(range.start));
    // Vercel's until is inclusive; our date range ends at the next day's midnight, exclusive.
    url.searchParams.set("until", new Date(Date.parse(madridMidnight(range.end)) - 1).toISOString());
    url.searchParams.set("filter", "requestPath eq '/' and environment eq 'production'");
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${config.token}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { available: false, reason: "No se pudieron consultar las visitas. Revisa la conexión y el período disponible en Vercel." };
    const body = await response.json();
    const totals = Array.isArray(body.data) ? body.data.length === 1 ? body.data[0] : body.data.length === 0 ? { pageviews: 0, visitors: 0 } : null : body.data;
    const parsed = counts.safeParse(totals);
    if (!parsed.success) throw new Error("Unexpected traffic response");
    return { available: true, ...parsed.data };
  } catch { return { available: false, reason: "Las visitas no están disponibles temporalmente. Las solicitudes siguen guardándose." }; }
}
