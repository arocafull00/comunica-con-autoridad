export type Campaign = { id: string; utm_source: string; utm_medium: string; utm_campaign: string; created_at: string; leads: number };
export type CampaignSuggestions = { sources: string[]; mediums: string[]; campaigns: string[] };

export const normalizeUtm = (value: string) => value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, "_").replace(/[^a-z0-9_.-]/g, "").slice(0, 100);

export const campaignLink = (origin: string, campaign: Pick<Campaign, "utm_source" | "utm_medium" | "utm_campaign">) =>
  `${origin}/?${new URLSearchParams({ utm_source: campaign.utm_source, utm_medium: campaign.utm_medium, utm_campaign: campaign.utm_campaign })}`;
