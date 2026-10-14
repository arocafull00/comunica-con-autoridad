import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { WhatsappOverview } from "../../whatsapp-form";
import { type WhatsappAutomation, whatsappJobStatus, whatsappStepTitle } from "@/lib/followups/whatsapp-automations";
import { AdminLoading } from "../../loading-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type WhatsappJob = {
  id: string;
  step: string;
  status: string;
  last_error: string | null;
  scheduled_at: string;
  payload: { phone?: string; name?: string } | null;
  registration: { email: string; lead: { name: string | null; phone: string | null } | null } | null;
};

async function Whatsapp() {
  "use cache: private";
  cacheLife({ stale: 60 });
  const { db } = await requireAdmin();
  const [settings, templates, audit, recent, ...counts] = await Promise.all([
    db.from("whatsapp_settings").select("enabled,template_id,revision,updated_at").single(),
    db.rpc("read_whatsapp_automation_catalog"),
    db.from("admin_audit").select("id,details,created_at,actor_email").order("created_at", { ascending: false }).limit(10),
    db.from("followup_jobs").select("id,step,status,last_error,scheduled_at,payload,registration:webinar_registrations(email,lead:leads(name,phone)),followup_steps!inner(channel)").eq("followup_steps.channel", "whatsapp").order("scheduled_at", { ascending: false }).order("id").limit(10).overrideTypes<WhatsappJob[], { merge: false }>(),
    ...["pending", "processing", "sent", "failed", "suppressed"].map((status) => db.from("followup_jobs").select("id,followup_steps!inner(channel)", { count: "exact", head: true }).eq("followup_steps.channel", "whatsapp").eq("status", status)),
  ]);
  if ([settings, templates, audit, recent, ...counts].some((r) => r.error) || !settings.data) throw new Error("No se pudo consultar WhatsApp.");

  return <div className="admin-page admin-whatsapp">
    <div className="admin-page-heading"><div><h1>WhatsApp</h1><p className="admin-muted">Mensajes fijos y envíos automáticos del webinar y las llamadas.</p></div></div>
    <WhatsappOverview automations={(templates.data ?? []) as WhatsappAutomation[]} settings={settings.data} />
    <div className="admin-whatsapp-details">
      <details className="admin-whatsapp-disclosure">
        <summary>Actividad de los mensajes<span>{counts[3].count ? `${counts[3].count} fallidos` : "Estados de envío"}</span></summary>
        <dl className="admin-stats admin-inline-stats admin-message-stats">{["Pendientes", "Procesando", "Aceptados por Meta", "Fallidos", "Omitidos"].map((name, i) => <div key={name}><dt>{name}</dt><dd className={i === 3 && counts[i].count ? "admin-error-count" : undefined}>{counts[i].count ?? 0}</dd></div>)}</dl>
        <p className="admin-context-note">“Aceptado por Meta” confirma la aceptación del envío, sin medir entrega ni lectura. Solo se envía a contactos con consentimiento. La activación también requiere que el servicio de WhatsApp y su programación estén configurados.</p>
        <section>
          <div className="admin-panel-heading"><h2>Últimos mensajes programados</h2></div>
          {recent.data?.length ? <div className="admin-data-table">
            <Table className="admin-table admin-whatsapp-activity" aria-label="Actividad de los mensajes de WhatsApp">
              <TableHeader><TableRow>
                <TableHead scope="col">Lead</TableHead>
                <TableHead scope="col">Teléfono</TableHead>
                <TableHead scope="col">Mensaje</TableHead>
                <TableHead scope="col">Programado</TableHead>
                <TableHead scope="col">Estado</TableHead>
                <TableHead scope="col">Detalle</TableHead>
              </TableRow></TableHeader>
              <TableBody>{recent.data.map((job) => {
                const lead = job.registration?.lead;
                const name = job.payload?.name || lead?.name || job.registration?.email || "Lead no disponible";
                const phone = job.payload?.phone || lead?.phone;
                return <TableRow key={job.id}>
                  <TableCell data-label="Lead"><strong>{name}</strong></TableCell>
                  <TableCell data-label="Teléfono">{phone ? <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" title={`Abrir WhatsApp con ${name}`}>{phone}</a> : <span className="admin-muted">No disponible</span>}</TableCell>
                  <TableCell data-label="Mensaje">{whatsappStepTitle(job.step)}</TableCell>
                  <TableCell data-label="Programado"><time dateTime={job.scheduled_at}>{new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" }).format(new Date(job.scheduled_at))}</time></TableCell>
                  <TableCell data-label="Estado"><Badge variant="outline" className={`admin-badge ${job.status === "sent" ? "admin-badge-enabled" : job.status === "failed" ? "admin-badge-failed" : ""}`}>{whatsappJobStatus(job.status, job.last_error)}</Badge></TableCell>
                  <TableCell data-label="Detalle">{job.last_error ? <span>{job.last_error}</span> : <span className="admin-muted">Sin incidencias</span>}</TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
          </div> : <p className="admin-context-note">Todavía no hay mensajes programados.</p>}
        </section>
      </details>
      <details className="admin-whatsapp-disclosure">
        <summary>Historial de configuración<span>Últimos {audit.data?.length ?? 0} cambios</span></summary>
        {audit.data?.length ? <ul className="admin-list">{audit.data.map((entry) => <li key={entry.id}><div><strong>{entry.details.previous?.enabled !== entry.details.enabled ? entry.details.enabled ? "Envíos activados" : "Envíos desactivados" : "Plantilla actualizada"}</strong><p>Administrador: {entry.actor_email ?? "Cuenta eliminada"}</p></div><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</time></li>)}</ul> : <p className="admin-context-note">Todavía no hay cambios registrados.</p>}
      </details>
    </div>
  </div>;
}
export default function Page() { return <Suspense fallback={<AdminLoading />}><Whatsapp /></Suspense>; }
