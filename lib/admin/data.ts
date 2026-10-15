import "server-only";
import { requireAdmin } from "./auth";
import { queryTraffic } from "./traffic";
import { comparisonPeriod } from "./comparison";
import type { FunnelEvent } from "@/lib/funnel";
import type { Campaign, CampaignSuggestions } from "./campaigns";
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
export async function getCampaigns() {
  const { db } = await requireAdmin();
  const [saved, used] = await Promise.all([
    db.rpc("get_campaigns"),
    db.from("leads").select("utm_source,utm_medium,utm_campaign").or("utm_source.not.is.null,utm_medium.not.is.null,utm_campaign.not.is.null").order("created_at", { ascending: false }).limit(1000),
  ]);
  if (saved.error) throw new Error("No se pudieron consultar las campañas.");
  const campaigns = (saved.data ?? []) as Campaign[];
  const rows = [...campaigns, ...(used.data ?? [])];
  const unique = (defaults: string[], key: "utm_source" | "utm_medium" | "utm_campaign") =>
    [...new Set([...defaults, ...rows.map((row) => row[key]).filter((value): value is string => Boolean(value))])];
  const suggestions: CampaignSuggestions = {
    sources: unique(["instagram", "facebook", "youtube", "tiktok", "linkedin", "google", "newsletter", "whatsapp"], "utm_source"),
    mediums: unique(["paid", "organic", "social", "email", "referral", "bio"], "utm_medium"),
    campaigns: unique([], "utm_campaign"),
  };
  return { campaigns, suggestions };
}
export async function getFunnel(range: { start: string; end: string }) {
  const { db } = await requireAdmin();
  const { data, error } = await db.rpc("get_funnel_metrics", { p_start: range.start, p_end: range.end });
  return error || !data ? null : data as Partial<Record<FunnelEvent, number>>;
}
