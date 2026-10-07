import "server-only";
import { requireAdmin } from "./auth";
import { queryTraffic } from "./traffic";
export type LeadMetrics = { leads: number; unique_emails: number; whatsapp_consents: number; daily: { day: string; leads: number; unique_emails: number }[]; campaigns: { utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; leads: number; unique_emails: number }[] };
export async function getDashboard(range: { start: string; end: string }) {
  const { db } = await requireAdmin();
  const [report, traffic] = await Promise.all([
    db.rpc("get_lead_metrics", { p_start: range.start, p_end: range.end }),
    queryTraffic(range, { token: process.env.VERCEL_ANALYTICS_TOKEN, projectId: process.env.VERCEL_ANALYTICS_PROJECT_ID, teamId: process.env.VERCEL_ANALYTICS_TEAM_ID }),
  ]);
  if (report.error || !report.data) throw new Error("No se pudieron consultar las solicitudes.");
  return { metrics: report.data as LeadMetrics, traffic };
}
