import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { WhatsappForm } from "../../whatsapp-form";
import { type WhatsappAutomation, whatsappAutomations, whatsappJobStatus } from "@/lib/followups/whatsapp-automations";
import { AdminLoading } from "../../loading-state";

async function Whatsapp() {
  "use cache: private";
  cacheLife({ stale: 60 });
  const { db } = await requireAdmin();
  const [settings, templates, audit, recent, ...counts] = await Promise.all([
    db.from("whatsapp_settings").select("enabled,template_id,revision,updated_at").single(),
    db.rpc("read_whatsapp_automation_catalog"),
    db.from("admin_audit").select("id,details,created_at,actor_email").order("created_at", { ascending: false }).limit(10),
    db.from("followup_jobs").select("id,step,status,last_error,scheduled_at,followup_steps!inner(channel)").eq("followup_steps.channel", "whatsapp").order("scheduled_at", { ascending: false }).limit(10),
    ...["pending", "processing", "sent", "failed", "suppressed"].map((status) => db.from("followup_jobs").select("id,followup_steps!inner(channel)", { count: "exact", head: true }).eq("followup_steps.channel", "whatsapp").eq("status", status)),
  ]);
  if ([settings, templates, audit, recent, ...counts].some((r) => r.error) || !settings.data) throw new Error("No se pudo consultar WhatsApp.");

  return <div className="admin-page admin-whatsapp">
    <div className="admin-page-heading"><div><h1>WhatsApp</h1><p className="admin-muted">Mensajes fijos y envíos automáticos del webinar y las llamadas.</p></div></div>
    <WhatsappForm automations={(templates.data ?? []) as WhatsappAutomation[]} settings={settings.data} />
    <div className="admin-whatsapp-details">
      <details className="admin-whatsapp-disclosure">
        <summary>Actividad de los mensajes<span>{counts[3].count ? `${counts[3].count} fallidos` : "Estados de envío"}</span></summary>
        <dl className="admin-stats admin-inline-stats admin-message-stats">{["Pendientes", "Procesando", "Aceptados por Meta", "Fallidos", "Omitidos"].map((name, i) => <div key={name}><dt>{name}</dt><dd className={i === 3 && counts[i].count ? "admin-error-count" : undefined}>{counts[i].count ?? 0}</dd></div>)}</dl>
        <p className="admin-context-note">“Aceptado por Meta” confirma la aceptación del envío, sin medir entrega ni lectura. Solo se envía a contactos con consentimiento. La activación también requiere que el servicio de WhatsApp y su programación estén configurados.</p>
        {recent.data?.length ? <section><div className="admin-panel-heading"><h2>Últimos mensajes programados</h2></div><ul className="admin-list">{recent.data.map((job) => <li key={job.id}><div><strong>{whatsappAutomations.find((definition) => definition.key === job.step)?.title ?? job.step}</strong><p>{whatsappJobStatus(job.status, job.last_error)}</p></div><time dateTime={job.scheduled_at}>{new Date(job.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</time></li>)}</ul></section> : null}
      </details>
      <details className="admin-whatsapp-disclosure">
        <summary>Historial de configuración<span>Últimos {audit.data?.length ?? 0} cambios</span></summary>
        {audit.data?.length ? <ul className="admin-list">{audit.data.map((entry) => <li key={entry.id}><div><strong>{entry.details.previous?.enabled !== entry.details.enabled ? entry.details.enabled ? "Envíos activados" : "Envíos desactivados" : "Plantilla actualizada"}</strong><p>Administrador: {entry.actor_email ?? "Cuenta eliminada"}</p></div><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</time></li>)}</ul> : <p className="admin-context-note">Todavía no hay cambios registrados.</p>}
      </details>
    </div>
  </div>;
}
export default function Page() { return <Suspense fallback={<AdminLoading />}><Whatsapp /></Suspense>; }
