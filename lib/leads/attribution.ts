export type LeadAttribution = { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null };

export function readLeadAttribution(search: string): LeadAttribution {
  const params = new URLSearchParams(search);
  const value = (key: string) => params.get(key)?.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 100) || null;
  return { utmSource: value("utm_source"), utmMedium: value("utm_medium"), utmCampaign: value("utm_campaign") };
}
