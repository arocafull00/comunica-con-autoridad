import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { WhatsappDeliveryStatus, WhatsappTemplates, metaManagerUrl } from "../../whatsapp-form";
import { WhatsappTemplateToolbar } from "../../whatsapp-template-toolbar";
import { type WhatsappAutomation, whatsappAudioSteps, whatsappAutomations, whatsappJobStatus, whatsappStepTitle } from "@/lib/followups/whatsapp-automations";
import { AdminLoading } from "../../loading-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination, pageParams } from "../../data-table-pagination";
import { JobFilters } from "../../job-filters";
import { type JobFilterSearchParams, jobFilterParams } from "../../job-filter-params";

type WhatsappJob = {
  id: string;
  step: string;
  status: string;
  last_error: string | null;
  scheduled_at: string;
  payload: { phone?: string; name?: string } | null;
  registration: { email: string; lead: { name: string | null; phone: string | null } | null } | null;
};

const whatsappSteps = [...whatsappAutomations, ...whatsappAudioSteps];
const STATUS_TONES: Record<string, string> = { sent: "done", failed: "failed", pending: "open", processing: "open" };

async function Whatsapp({ searchParams }: { searchParams: Promise<JobFilterSearchParams> }) {
  "use cache: private";
  cacheLife({ stale: 60 });
  const params = await searchParams;
  const { page, perPage, from, to } = pageParams(params);
  const filters = jobFilterParams(params, whatsappSteps.map((step) => step.key));
  const { db } = await requireAdmin();
  const [settings, templates, audit, recent, ...counts] = await Promise.all([
    db.from("whatsapp_settings").select("enabled,template_id,revision,updated_at").single(),
    db.rpc("read_whatsapp_automation_catalog"),
    db.from("admin_audit").select("id,details,created_at,actor_email").order("created_at", { ascending: false }).limit(10),
    db.from("followup_jobs").select("id,step,status,last_error,scheduled_at,payload,registration:webinar_registrations(email,lead:leads(name,phone)),followup_steps!inner(channel)", { count: "exact" }).eq("followup_steps.channel", "whatsapp").match({ ...(filters.status && { status: filters.status }), ...(filters.step && { step: filters.step }) }).order("scheduled_at", { ascending: filters.order === "asc" }).order("id").range(from, to).overrideTypes<WhatsappJob[], { merge: false }>(),
    ...["pending", "processing", "sent", "failed", "suppressed"].map((status) => db.from("followup_jobs").select("id,followup_steps!inner(channel)", { count: "exact", head: true }).eq("followup_steps.channel", "whatsapp").eq("status", status)),
  ]);
  if ([settings, templates, audit, recent, ...counts].some((r) => r.error) || !settings.data) throw new Error("No se pudo consultar WhatsApp.");
  const automations = (templates.data ?? []) as WhatsappAutomation[];

  return <div className="admin-page admin-whatsapp">
    <div className="admin-page-heading"><div><h1>WhatsApp</h1><p className="admin-muted">Mensajes fijos y envíos automáticos del webinar y las llamadas.</p></div><div><WhatsappTemplateToolbar metaManagerUrl={metaManagerUrl} /></div></div>
    <JobFilters pathname="/admin/whatsapp" perPage={perPage} {...filters} steps={whatsappSteps} />
    <div className="data-table">
      <Table aria-label="Actividad de los mensajes de WhatsApp">
        <TableHeader><TableRow>
          <TableHead scope="col">Lead</TableHead>
          <TableHead scope="col" className="col-hide-sm">Teléfono</TableHead>
          <TableHead scope="col" className="col-hide-sm">Mensaje</TableHead>
          <TableHead scope="col" className="col-hide-md">Programado</TableHead>
          <TableHead scope="col">Estado</TableHead>
          <TableHead scope="col" className="col-hide-lg">Detalle</TableHead>
        </TableRow></TableHeader>
        <TableBody>{recent.data?.length ? recent.data.map((job) => {
          const lead = job.registration?.lead;
          const name = job.payload?.name || lead?.name || job.registration?.email || "Lead no disponible";
          const phone = job.payload?.phone || lead?.phone;
          return <TableRow key={job.id}>
            <TableCell><span className="data-table-name" title={job.registration?.email}>{name}</span></TableCell>
            <TableCell className="col-hide-sm">{phone ? <a className="data-table-phone" href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" title={`Abrir WhatsApp con ${name}`}>{phone}</a> : <span className="data-table-sub">No disponible</span>}</TableCell>
            <TableCell className="col-hide-sm"><span className="data-table-line">{whatsappStepTitle(job.step)}</span></TableCell>
            <TableCell className="col-hide-md"><time className="data-table-sub" dateTime={job.scheduled_at}>{new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" }).format(new Date(job.scheduled_at))}</time></TableCell>
            <TableCell><Badge variant="outline" className="data-table-status" data-tone={STATUS_TONES[job.status] ?? "idle"}>{whatsappJobStatus(job.status, job.last_error)}</Badge></TableCell>
            <TableCell className="col-hide-lg"><span className="data-table-sub data-table-detail" title={job.last_error ?? undefined}>{job.last_error ?? "Sin incidencias"}</span></TableCell>
          </TableRow>;
        }) : <TableRow><TableCell colSpan={6} className="data-table-empty">{Object.keys(filters.query).length ? "No hay mensajes con estos filtros." : "Todavía no hay mensajes programados."}</TableCell></TableRow>}</TableBody>
      </Table>
    </div>
    <DataTablePagination page={page} perPage={perPage} total={recent.count ?? 0} pathname="/admin/whatsapp" query={filters.query} />
    <div className="admin-whatsapp-details">
      <details className="admin-whatsapp-disclosure">
        <summary>Estado de los envíos<span>{counts[3].count ? `${counts[3].count} fallidos` : settings.data.enabled ? "Habilitados" : "Pausados"}</span></summary>
        <WhatsappDeliveryStatus automations={automations} settings={settings.data} />
        <dl className="admin-stats admin-inline-stats admin-message-stats">{["Pendientes", "Procesando", "Aceptados por Meta", "Fallidos", "Omitidos"].map((name, i) => <div key={name}><dt>{name}</dt><dd className={i === 3 && counts[i].count ? "admin-error-count" : undefined}>{counts[i].count ?? 0}</dd></div>)}</dl>
        <p className="admin-context-note">“Aceptado por Meta” confirma la aceptación del envío, sin medir entrega ni lectura. Solo se envía a contactos con consentimiento. La activación también requiere que el servicio de WhatsApp y su programación estén configurados.</p>
      </details>
      <WhatsappTemplates automations={automations} />
      <details className="admin-whatsapp-disclosure">
        <summary>Historial de configuración<span>Últimos {audit.data?.length ?? 0} cambios</span></summary>
        {audit.data?.length ? <ul className="admin-list">{audit.data.map((entry) => <li key={entry.id}><div><strong>{entry.details.previous?.enabled !== entry.details.enabled ? entry.details.enabled ? "Envíos activados" : "Envíos desactivados" : "Plantilla actualizada"}</strong><p>Administrador: {entry.actor_email ?? "Cuenta eliminada"}</p></div><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</time></li>)}</ul> : <p className="admin-context-note">Todavía no hay cambios registrados.</p>}
      </details>
    </div>
  </div>;
}
export default function Page({ searchParams }: { searchParams: Promise<JobFilterSearchParams> }) { return <Suspense fallback={<AdminLoading />}><Whatsapp searchParams={searchParams} /></Suspense>; }
