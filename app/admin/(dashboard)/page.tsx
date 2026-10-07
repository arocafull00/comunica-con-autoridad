import { Suspense } from "react";
import { connection } from "next/server";
import { CalendarDays, Inbox, Megaphone } from "lucide-react";
import { getDashboard } from "@/lib/admin/data";
import { dateRange } from "@/lib/admin/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DailyChart, CampaignChart } from "../charts";
import { AdminLoading } from "../loading-state";
function RangeForm({ start, end }: { start: string; end: string }) {
  return <form className="admin-filters" method="get"><Label>Desde<Input type="date" name="start" defaultValue={start} required /></Label><Label>Hasta (sin incluir)<Input type="date" name="end" defaultValue={end} required /></Label><Button type="submit">Aplicar período</Button></form>;
}
async function Summary({ searchParams }: { searchParams: Promise<{ start?: string; end?: string }> }) {
  await connection();
  const params = await searchParams;
  const range = dateRange(params.start, params.end);
  const { metrics, traffic } = await getDashboard(range);
  const conversion = traffic.available && traffic.visitors > 0 ? `${(metrics.leads / traffic.visitors * 100).toFixed(1)} %` : null;
  const format = (value: number) => new Intl.NumberFormat("es-ES").format(value);
  return <>
    <div className="admin-page-heading"><div><h1>Resumen</h1><p className="admin-muted">Consulta cómo llegan las solicitudes a tu web.</p></div><Badge variant="outline" className="admin-badge"><CalendarDays size={14} aria-hidden="true" />Europe/Madrid</Badge></div>
    <RangeForm {...range} />
    {range.error ? <p role="alert" className="admin-error">{range.error} Se muestra el período predeterminado.</p> : null}
    <Card className="admin-panel" aria-labelledby="capture-heading">
      <div className="admin-panel-heading"><h2 id="capture-heading">Captación</h2><span>En el período seleccionado</span></div>
      <dl className="admin-stats admin-capture-stats">{[["Solicitudes", metrics.leads], ["Correos únicos", metrics.unique_emails], ["Consentimientos WhatsApp", metrics.whatsapp_consents]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{format(Number(value))}</dd></div>)}</dl>
      <div className="admin-traffic"><div className="admin-panel-heading"><h2>Tráfico de la web</h2><span>Vercel Analytics</span></div>
        <dl className="admin-stats">{[["Visitantes", traffic.available ? format(traffic.visitors) : null], ["Páginas vistas", traffic.available ? format(traffic.pageviews) : null], ["Conversión orientativa", conversion]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd className={value === null ? "admin-unavailable" : undefined}>{value ?? "No disponible"}</dd></div>)}</dl>
        {!traffic.available ? <Alert role="status" className="admin-notice"><AlertDescription>{traffic.reason}</AlertDescription></Alert> : null}
        <p className="admin-muted">Conversión: solicitudes / visitantes. Una persona puede enviar varias solicitudes. Los correos únicos no equivalen necesariamente a personas únicas.</p>
      </div>
    </Card>
    <div className="admin-report-grid">
      <Card className="admin-panel"><div className="admin-panel-heading"><h2>Solicitudes por día</h2><span>Actividad</span></div>
        {metrics.daily.length ? <DailyChart daily={metrics.daily} start={range.start} end={range.end} /> : <div className="admin-empty"><Inbox size={24} aria-hidden="true" /><strong>Aún no hay solicitudes en este período</strong><p>Amplía las fechas para consultar la actividad anterior.</p></div>}
      </Card>
      <Card className="admin-panel"><div className="admin-panel-heading"><h2>Campañas</h2><span>Origen de solicitudes</span></div>
        {metrics.campaigns.length ? <><CampaignChart campaigns={metrics.campaigns} /><ul className="admin-list admin-campaigns">{metrics.campaigns.map((campaign, i) => <li key={i}><div><strong>{campaign.utm_campaign ?? "Sin campaña"}</strong><p>{campaign.utm_source ?? "Sin fuente"} · {campaign.utm_medium ?? "Sin medio"}</p><p>{campaign.unique_emails} correos únicos</p></div><div className="admin-campaign-count"><strong>{format(campaign.leads)}</strong><span>solicitudes</span></div></li>)}</ul></> : <div className="admin-empty"><Megaphone size={24} aria-hidden="true" /><strong>Sin campañas con solicitudes</strong><p>Los enlaces con parámetros UTM permiten identificar de dónde llega cada solicitud.</p></div>}
      </Card>
    </div>
  </>;
}
export default function Page({ searchParams }: { searchParams: Promise<{ start?: string; end?: string }> }) { return <Suspense fallback={<AdminLoading label="Cargando estadísticas…" />}><Summary searchParams={searchParams} /></Suspense>; }
