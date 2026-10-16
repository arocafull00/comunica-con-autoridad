import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { emailAutomations, emailJobError, emailJobStatus, emailStepTitle } from "@/lib/followups/email-automations";
import { AdminLoading } from "../../loading-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination, pageParams } from "../../data-table-pagination";
import { JobFilters } from "../../job-filters";
import { type JobFilterSearchParams, jobFilterParams } from "../../job-filter-params";

type EmailJob = {
  id: string;
  step: string;
  status: string;
  last_error: string | null;
  scheduled_at: string;
  sent_at: string | null;
  payload: { name?: string } | null;
  registration: { email: string; lead: { name: string | null } | null } | null;
};

const STATUS_TONES: Record<string, string> = { sent: "done", failed: "failed", pending: "open", processing: "open" };
const formatDate = (value: string) => new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

async function Emails({ searchParams }: { searchParams: Promise<JobFilterSearchParams> }) {
  "use cache: private";
  cacheLife({ stale: 60 });
  const params = await searchParams;
  const { page, perPage, from, to } = pageParams(params);
  const filters = jobFilterParams(params, emailAutomations.map((step) => step.key));
  const { db } = await requireAdmin();
  const [steps, unsubscribed, recent, ...counts] = await Promise.all([
    db.from("followup_steps").select("key,subject").eq("channel", "email"),
    db.from("webinar_registrations").select("id", { count: "exact", head: true }).not("email_unsubscribed_at", "is", null),
    db.from("followup_jobs").select("id,step,status,last_error,scheduled_at,sent_at,payload,registration:webinar_registrations(email,lead:leads(name)),followup_steps!inner(channel)", { count: "exact" }).eq("followup_steps.channel", "email").match({ ...(filters.status && { status: filters.status }), ...(filters.step && { step: filters.step }) }).order("scheduled_at", { ascending: filters.order === "asc" }).order("id").range(from, to).overrideTypes<EmailJob[], { merge: false }>(),
    ...["pending", "processing", "sent", "failed", "suppressed"].map((status) => db.from("followup_jobs").select("id,followup_steps!inner(channel)", { count: "exact", head: true }).eq("followup_steps.channel", "email").eq("status", status)),
  ]);
  if ([steps, unsubscribed, recent, ...counts].some((r) => r.error)) throw new Error("No se pudo consultar los emails.");
  const subjects = new Map((steps.data ?? []).map((step) => [step.key, step.subject as string | null]));

  return <div className="admin-page admin-emails">
    <div className="admin-page-heading"><div><h1>Emails</h1><p className="admin-muted">Secuencia automática de seguimiento tras la inscripción a la masterclass.</p></div></div>
    <JobFilters pathname="/admin/emails" perPage={perPage} {...filters} steps={emailAutomations} />
    <div className="data-table">
      <Table aria-label="Actividad de los emails de seguimiento">
        <TableHeader><TableRow>
          <TableHead scope="col">Lead</TableHead>
          <TableHead scope="col" className="col-hide-sm">Email</TableHead>
          <TableHead scope="col" className="col-hide-sm">Mensaje</TableHead>
          <TableHead scope="col" className="col-hide-md">Programado</TableHead>
          <TableHead scope="col">Estado</TableHead>
          <TableHead scope="col" className="col-hide-lg">Detalle</TableHead>
        </TableRow></TableHeader>
        <TableBody>{recent.data?.length ? recent.data.map((job) => {
          const email = job.registration?.email;
          const name = job.payload?.name || job.registration?.lead?.name || email || "Lead no disponible";
          const detail = emailJobError(job.last_error) ?? (job.sent_at ? `Enviado el ${formatDate(job.sent_at)}` : "Sin incidencias");
          return <TableRow key={job.id}>
            <TableCell><span className="data-table-name" title={email}>{name}</span></TableCell>
            <TableCell className="col-hide-sm">{email ? <a className="data-table-phone" href={`mailto:${email}`} title={`Escribir a ${name}`}>{email}</a> : <span className="data-table-sub">No disponible</span>}</TableCell>
            <TableCell className="col-hide-sm"><span className="data-table-line" title={subjects.get(job.step) ?? undefined}>{emailStepTitle(job.step)}</span></TableCell>
            <TableCell className="col-hide-md"><time className="data-table-sub" dateTime={job.scheduled_at}>{formatDate(job.scheduled_at)}</time></TableCell>
            <TableCell><Badge variant="outline" className="data-table-status" data-tone={STATUS_TONES[job.status] ?? "idle"}>{emailJobStatus(job.status, job.last_error)}</Badge></TableCell>
            <TableCell className="col-hide-lg"><span className="data-table-sub data-table-detail" title={job.last_error ?? undefined}>{detail}</span></TableCell>
          </TableRow>;
        }) : <TableRow><TableCell colSpan={6} className="data-table-empty">{Object.keys(filters.query).length ? "No hay emails con estos filtros." : "Todavía no hay emails programados."}</TableCell></TableRow>}</TableBody>
      </Table>
    </div>
    <DataTablePagination page={page} perPage={perPage} total={recent.count ?? 0} pathname="/admin/emails" query={filters.query} />
    <div className="admin-whatsapp-details">
      <details className="admin-whatsapp-disclosure">
        <summary>Estado de los envíos<span>{counts[3].count ? `${counts[3].count} fallidos` : `${counts[2].count ?? 0} enviados`}</span></summary>
        <dl className="admin-stats admin-inline-stats admin-message-stats">{["Pendientes", "Procesando", "Aceptados por Resend", "Fallidos", "Omitidos"].map((name, i) => <div key={name}><dt>{name}</dt><dd className={i === 3 && counts[i].count ? "admin-error-count" : undefined}>{counts[i].count ?? 0}</dd></div>)}</dl>
        <p className="admin-context-note">“Aceptado por Resend” confirma que Resend aceptó el envío, sin medir entrega ni apertura. Solo se envía a contactos que marcaron la casilla de email y no se han dado de baja ({unsubscribed.count ?? 0} bajas hasta ahora). La activación depende de la configuración de Resend en el worker de seguimiento.</p>
      </details>
      <details className="admin-whatsapp-disclosure">
        <summary>Secuencia de emails<span>{emailAutomations.length} emails</span></summary>
        <ul className="admin-list">{emailAutomations.map((automation) => <li key={automation.key}><div><strong>{automation.title}</strong><p>{subjects.get(automation.key) ? `«${subjects.get(automation.key)}»` : "Sin asunto configurado"}</p><p>Plantilla de Resend: {automation.template}</p></div><span className="admin-muted">{automation.trigger}</span></li>)}</ul>
      </details>
    </div>
  </div>;
}
export default function Page({ searchParams }: { searchParams: Promise<JobFilterSearchParams> }) { return <Suspense fallback={<AdminLoading />}><Emails searchParams={searchParams} /></Suspense>; }
