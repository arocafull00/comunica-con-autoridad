import "server-only";
import { requireAdmin } from "./auth";
import { queryTraffic } from "./traffic";
import { comparisonPeriod } from "./comparison";
export type LeadMetrics = { leads: number; unique_emails: number; whatsapp_consents: number; daily: { day: string; leads: number; unique_emails: number }[]; campaigns: { utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; leads: number; unique_emails: number }[] };
export async function getDashboard(range: { start: string; end: string }) {
  const { db } = await requireAdmin();
  const comparison = comparisonPeriod(range);
  const trafficConfig = { token: process.env.VERCEL_ANALYTICS_TOKEN, projectId: process.env.VERCEL_ANALYTICS_PROJECT_ID, teamId: process.env.VERCEL_ANALYTICS_TEAM_ID };
  const [report, traffic, previousReport, previousTraffic] = await Promise.all([
    db.rpc("get_lead_metrics", { p_start: range.start, p_end: range.end }),
    queryTraffic(range, trafficConfig),
    db.rpc("get_lead_metrics", { p_start: comparison.range.start, p_end: comparison.range.end }),
    queryTraffic(comparison.range, trafficConfig),
  ]);
  if (report.error || !report.data) throw new Error("No se pudieron consultar las solicitudes.");
  return { metrics: report.data as LeadMetrics, traffic, comparison,
    previous: { metrics: previousReport.error || !previousReport.data ? null : previousReport.data as LeadMetrics, traffic: previousTraffic } };
}
