import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { Filter } from "lucide-react";
import { getFunnel } from "@/lib/admin/data";
import { dateRange } from "@/lib/admin/validation";
import { FUNNEL_STEPS, type FunnelEvent } from "@/lib/funnel";
import { DateRangeFilter } from "../../date-range-filter";
import { AdminLoading } from "../../loading-state";

const format = (value: number) => new Intl.NumberFormat("es-ES").format(value);
const percent = (value: number, base: number) => base > 0 ? `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value / base * 100)} %` : "—";

function FunnelCards({ funnel }: { funnel: Partial<Record<FunnelEvent, number>> }) {
  const visits = funnel.visit ?? 0;
  return <ol className="admin-funnel">{FUNNEL_STEPS.map((step, i) => {
    const count = funnel[step.event as FunnelEvent] ?? 0;
    const previous = i > 0 ? funnel[FUNNEL_STEPS[i - 1].event as FunnelEvent] ?? 0 : null;
    return <li key={step.event} className="admin-funnel-card">
      <div className="admin-funnel-card-heading"><span>{i + 1}</span><strong>{step.label}</strong></div>
      <p className="admin-funnel-card-count"><strong>{format(count)}</strong> sesiones</p>
      <dl className="admin-funnel-card-rates">
        <div><dt>De las visitas</dt><dd>{percent(count, visits)}</dd></div>
        <div><dt>Del paso anterior</dt><dd>{previous !== null ? percent(count, previous) : "—"}</dd></div>
      </dl>
      <div className="admin-campaign-bar" aria-hidden="true"><span style={{ width: `${visits > 0 ? Math.min(100, count / visits * 100) : 0}%` }} /></div>
    </li>;
  })}</ol>;
}

async function Funnel({ searchParams }: { searchParams: Promise<{ start?: string; end?: string }> }) {
  "use cache: private";
  cacheLife({ stale: 60 });
  const params = await searchParams;
  const range = dateRange(params.start, params.end);
  const funnel = await getFunnel(range);
  return <div className="admin-page admin-funnel-page">
    <div className="admin-page-heading">
      <div><h1>Embudo</h1><p className="admin-muted">Sesiones que llegan a cada paso de la clase y del formulario</p></div>
      <DateRangeFilter key={`${range.start}-${range.end}`} {...range} todayEnd={dateRange().end} pathname="/admin/funnel" />
    </div>
    {range.error ? <p role="alert" className="admin-error">{range.error} Se muestra el período predeterminado.</p> : null}
    {funnel === null ? <p role="status" className="admin-error">El embudo no está disponible temporalmente.</p>
      : funnel.visit ? <>
        <FunnelCards funnel={funnel} />
        <details className="admin-chart-note admin-metric-help"><summary>Cómo se mide el embudo</summary><p>Cada carga de la página es una sesión anónima, sin cookies ni datos de contacto, y cuenta una sola vez por paso. Una persona que vuelve otro día cuenta como otra sesión; quien regresa con el formulario empezado puede aparecer en las preguntas sin haber pasado por los pasos anteriores en esa sesión. Los bloqueadores y las conexiones interrumpidas pueden impedir registrar algún paso. El detalle de cada contacto está en Contactos.</p></details>
      </> : <div className="admin-empty"><Filter size={24} aria-hidden="true" /><strong>Aún no hay sesiones registradas en este período</strong><p>Amplía las fechas para consultar la actividad anterior.</p></div>}
  </div>;
}

export default function Page({ searchParams }: { searchParams: Promise<{ start?: string; end?: string }> }) { return <Suspense fallback={<AdminLoading />}><Funnel searchParams={searchParams} /></Suspense>; }
