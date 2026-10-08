import { Suspense } from "react";
import Link from "next/link";
import { cacheLife } from "next/cache";
import { ArrowUpRight, Inbox, Megaphone } from "lucide-react";
import { getDashboard, type LeadMetrics } from "@/lib/admin/data";
import { dateRange } from "@/lib/admin/validation";
import { DailyChart } from "../charts";
import { DateRangeFilter } from "../date-range-filter";
import { AdminLoading } from "../loading-state";

const format = (value: number) => new Intl.NumberFormat("es-ES").format(value);

function CampaignRows({ campaigns, max }: { campaigns: LeadMetrics["campaigns"]; max: number }) {
  return <ul className="admin-list admin-campaigns">{campaigns.map((campaign, i) => <li key={i}>
    <div className="admin-campaign-detail">
      <strong>{campaign.utm_campaign ?? "Sin campaña"}</strong>
      <p>{campaign.utm_source ?? "Sin fuente"} · {campaign.utm_medium ?? "Sin medio"} · {format(campaign.unique_emails)} correos únicos</p>
      <div className="admin-campaign-bar" aria-hidden="true"><span style={{ width: `${max > 0 ? campaign.leads / max * 100 : 0}%` }} /></div>
    </div>
    <div className="admin-campaign-count"><strong>{format(campaign.leads)}</strong><span>solicitudes</span></div>
  </li>)}</ul>;
}

async function Summary({ searchParams }: { searchParams: Promise<{ start?: string; end?: string }> }) {
  "use cache: private";
  cacheLife({ stale: 60 });
  const params = await searchParams;
  const range = dateRange(params.start, params.end);
  const defaultRange = dateRange();
  const { metrics, traffic } = await getDashboard(range);
  const conversion = traffic.available && traffic.visitors > 0 ? `${(metrics.leads / traffic.visitors * 100).toFixed(1)} %` : null;
  const campaigns = [...metrics.campaigns].sort((a, b) => b.leads - a.leads);
  const campaignMax = campaigns[0]?.leads ?? 0;
  return <div className="admin-summary">
    <div className="admin-page-heading admin-summary-heading">
      <div><h1>Resumen</h1><p className="admin-muted">Captación y actividad de tu web</p></div>
      <DateRangeFilter key={`${range.start}-${range.end}`} start={range.start} end={range.end} todayEnd={defaultRange.end} />
    </div>
    {range.error ? <p role="alert" className="admin-error">{range.error} Se muestra el período predeterminado.</p> : null}

    <section className="admin-overview" aria-label="Métricas de captación">
      <dl className="admin-overview-stats">
        <div className="admin-metric-primary"><dt>Solicitudes</dt><dd>{format(metrics.leads)}</dd></div>
        <div><dt>Correos únicos</dt><dd>{format(metrics.unique_emails)}</dd></div>
        <div><dt>Consentimientos WhatsApp</dt><dd>{format(metrics.whatsapp_consents)}</dd></div>
        <div><dt>Conversión orientativa</dt><dd className={conversion === null ? "admin-metric-unavailable" : undefined} aria-label={conversion === null ? "No disponible" : undefined}>{conversion ?? "—"}</dd></div>
      </dl>
    </section>

    <div className="admin-summary-reports">
      <section className="admin-report" aria-labelledby="daily-heading">
        <div className="admin-panel-heading"><h2 id="daily-heading">Solicitudes por día</h2><Link className="admin-report-link" href={`/admin/contacts?${new URLSearchParams({ start: range.start, end: range.end })}`}>Ver contactos<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
        {metrics.daily.length ? <DailyChart daily={metrics.daily} start={range.start} end={range.end} /> : <div className="admin-empty"><Inbox size={24} aria-hidden="true" /><strong>Aún no hay solicitudes en este período</strong><p>Amplía las fechas para consultar la actividad anterior.</p></div>}
      </section>
      <section className="admin-report" aria-labelledby="campaign-heading">
        <div className="admin-panel-heading"><h2 id="campaign-heading">Campañas</h2><span>Solicitudes por origen</span></div>
        {campaigns.length ? <>
          <CampaignRows campaigns={campaigns.slice(0, 5)} max={campaignMax} />
          {campaigns.length > 5 ? <details className="admin-chart-note"><summary>Ver {campaigns.length - 5} campañas más</summary><CampaignRows campaigns={campaigns.slice(5)} max={campaignMax} /></details> : null}
        </> : <div className="admin-empty"><Megaphone size={24} aria-hidden="true" /><strong>Sin campañas con solicitudes</strong><p>Los enlaces con parámetros UTM permiten identificar de dónde llega cada solicitud.</p></div>}
      </section>
    </div>

    <section className="admin-summary-traffic" aria-labelledby="traffic-heading">
      <div className="admin-traffic-heading"><h2 id="traffic-heading">Tráfico de la web</h2><span>Vercel Analytics</span></div>
      <dl className="admin-traffic-stats">{[["Visitantes", traffic.available ? format(traffic.visitors) : null], ["Páginas vistas", traffic.available ? format(traffic.pageviews) : null]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd className={value === null ? "admin-metric-unavailable" : undefined} aria-label={value === null ? "No disponible" : undefined}>{value ?? "—"}</dd></div>)}</dl>
      {!traffic.available ? <p role="status" className="admin-traffic-status">Vercel Analytics: {traffic.reason}</p> : null}
      <details className="admin-chart-note admin-metric-help"><summary>Cómo se calculan estos datos</summary><p>Conversión: solicitudes / visitantes. Una persona puede enviar varias solicitudes. Los correos únicos no equivalen necesariamente a personas únicas. Las fechas incluyen ambos días y usan la hora de Madrid. El tráfico sin medir se muestra como no disponible.</p></details>
    </section>
  </div>;
}

export default function Page({ searchParams }: { searchParams: Promise<{ start?: string; end?: string }> }) { return <Suspense fallback={<AdminLoading />}><Summary searchParams={searchParams} /></Suspense>; }
