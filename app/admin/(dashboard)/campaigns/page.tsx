import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { getCampaigns } from "@/lib/admin/data";
import { AdminLoading } from "../../loading-state";
import { CampaignLinkBuilder, SavedCampaigns } from "../../campaign-link-builder";

async function Campaigns() {
  "use cache: private";
  cacheLife({ stale: 60 });
  const { campaigns, suggestions } = await getCampaigns();
  return <div className="admin-page admin-campaigns-page">
    <div className="admin-page-heading"><div><h1>Campañas</h1><p className="admin-muted">Genera enlaces con parámetros UTM para saber de dónde llega cada solicitud</p></div></div>
    <CampaignLinkBuilder suggestions={suggestions} />
    <SavedCampaigns campaigns={campaigns} />
  </div>;
}

export default function Page() { return <Suspense fallback={<AdminLoading />}><Campaigns /></Suspense>; }
