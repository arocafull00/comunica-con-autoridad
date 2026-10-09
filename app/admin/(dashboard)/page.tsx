import { Suspense } from "react";
import Link from "next/link";
import { cacheLife } from "next/cache";
import { ArrowUpRight, Inbox, Megaphone } from "lucide-react";
import { getDashboard, type LeadMetrics } from "@/lib/admin/data";
import { dateRange } from "@/lib/admin/validation";
import { DailyChart } from "../charts";
import { DateRangeFilter } from "../date-range-filter";
import { AdminLoading } from "../loading-state";
import { MetricComparison } from "../metric-comparison";
import { conversionRate } from "@/lib/admin/comparison";

const format = (value: number) => new Intl.NumberFormat("es-ES").format(value);

function Metric({ label, current, previous, days, rate = false }: {
  label: string; current: number | null; previous: number | null; days: number; rate?: boolean;
}) {
  const value = current === null ? "—" : rate
    ? `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(current)} %`
    : format(current);
  return <>
    <dt>{label}</dt>
    <dd className={current === null ? "admin-metric-unavailable" : undefined} aria-label={current === null ? "No disponible" : undefined}>{value}</dd>
    <dd className="admin-metric-comparison"><MetricComparison label={label} current={current} previous={previous} days={days} rate={rate} /></dd>
  </>;
}

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
  const { metrics, traffic, previous, comparison } = await getDashboard(range);
  const conversion = conversionRate(metrics.leads, traffic.available ? traffic.visitors : null);
  const previousConversion = previous.metrics ? conversionRate(previous.metrics.leads, previous.traffic.available ? previous.traffic.visitors : null) : null;
  const campaigns = [...metrics.campaigns].sort((a, b) => b.leads - a.leads);
  const campaignMax = campaigns[0]?.leads ?? 0;
  return <div className="admin-summary">
    <div className="admin-page-heading admin-summary-heading">
      <div><h1>Resumen</h1><p className="admin-muted">Captación y actividad de tu web</p></div>
      <DateRangeFilter key={`${range.start}-${range.end}`} start={range.start} end={range.end} todayEnd={defaultRange.end} />
    </div>
    {range.error ? <p role="alert" className="admin-error">{range.error} Se muestra el período predeterminado.</p> : null}

    <section className="admin-overview" aria-label="Métricas del período">
      <div className="admin-bento" key={`${range.start}-${range.end}`}>
        <section className="admin-bento-traffic" aria-labelledby="traffic-heading">
          <div className="admin-traffic-heading"><h2 id="traffic-heading">Tráfico de la web</h2></div>
          <dl className="admin-bento-traffic-stats">
            <div className="admin-bento-visitors"><Metric label="Visitantes" current={traffic.available ? traffic.visitors : null} previous={previous.traffic.available ? previous.traffic.visitors : null} days={comparison.days} /></div>
            <div className="admin-bento-pageviews"><Metric label="Páginas vistas" current={traffic.available ? traffic.pageviews : null} previous={previous.traffic.available ? previous.traffic.pageviews : null} days={comparison.days} /></div>
          </dl>
          {!traffic.available ? <p role="status" className="admin-traffic-status">{traffic.reason}</p> : null}
        </section>
        <dl className="admin-bento-emails"><Metric label="Correos únicos" current={metrics.unique_emails} previous={previous.metrics?.unique_emails ?? null} days={comparison.days} /></dl>
        <dl className="admin-bento-requests"><Metric label="Solicitudes" current={metrics.leads} previous={previous.metrics?.leads ?? null} days={comparison.days} /></dl>
        <dl className="admin-bento-consents"><Metric label="Consentimientos WhatsApp" current={metrics.whatsapp_consents} previous={previous.metrics?.whatsapp_consents ?? null} days={comparison.days} /></dl>
        <dl className="admin-bento-conversion"><Metric label="Conversión orientativa" current={conversion} previous={previousConversion} days={comparison.days} rate /></dl>
      </div>
      <div className="admin-overview-note"><span>Pulsa una variación para ver el cambio en porcentaje o en cifras.</span><details className="admin-chart-note admin-metric-help"><summary>Cómo se calculan estos datos</summary><p>Se compara el período seleccionado con los {comparison.days} días inmediatamente anteriores. Correos únicos cuenta las direcciones distintas en cada período, no solo direcciones registradas por primera vez. Conversión: solicitudes / visitantes; su diferencia absoluta se expresa en puntos porcentuales. Una persona puede enviar varias solicitudes. Las fechas incluyen ambos días y usan la hora de Madrid. Sin datos medidos no hay comparación; con una base anterior de cero, solo se puede calcular la diferencia absoluta.</p></details></div>
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

  </div>;
}

export default function Page({ searchParams }: { searchParams: Promise<{ start?: string; end?: string }> }) { return <Suspense fallback={<AdminLoading />}><Summary searchParams={searchParams} /></Suspense>; }
