import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { WhatsappForm, type Template } from "../../whatsapp-form";
import { AdminLoading } from "../../loading-state";

async function Whatsapp() {
  "use cache: private";
  cacheLife({ stale: 60 });
  const { db } = await requireAdmin();
  const [settings, templates, audit, failures, ...counts] = await Promise.all([
    db.from("whatsapp_settings").select("enabled,template_id,revision,updated_at").single(),
    db.from("whatsapp_templates").select("id,name,language,body,approved,meta_status,verified_at,category,components").order("name"),
    db.from("admin_audit").select("id,details,created_at,actor_email").order("created_at", { ascending: false }).limit(10),
    db.from("whatsapp_messages").select("id,last_error,created_at,leads!inner(source)").eq("leads.source", "web").eq("status", "failed").order("created_at", { ascending: false }).limit(10),
    ...["pending", "processing", "sent", "failed"].map((status) => db.from("whatsapp_messages").select("id,leads!inner(source)", { count: "exact", head: true }).eq("leads.source", "web").eq("status", status)),
  ]);
  if ([settings, templates, audit, failures, ...counts].some((r) => r.error) || !settings.data) throw new Error("No se pudo consultar WhatsApp.");

  return <div className="admin-page admin-whatsapp">
    <div className="admin-page-heading"><div><h1>WhatsApp</h1><p className="admin-muted">Gestiona el mensaje que reciben tus contactos.</p></div></div>
    <WhatsappForm templates={(templates.data ?? []) as Template[]} settings={settings.data} />
    <div className="admin-whatsapp-details">
      <details className="admin-whatsapp-disclosure">
        <summary>Actividad de los mensajes<span>{counts[3].count ? `${counts[3].count} fallidos` : "Estados de envío"}</span></summary>
        <dl className="admin-stats admin-inline-stats admin-message-stats">{["Pendientes", "Procesando", "Aceptados por Meta", "Fallidos"].map((name, i) => <div key={name}><dt>{name}</dt><dd className={i === 3 && counts[i].count ? "admin-error-count" : undefined}>{counts[i].count ?? 0}</dd></div>)}</dl>
        <p className="admin-context-note">“Aceptado por Meta” confirma la aceptación del envío, sin medir entrega ni lectura. Solo se envía a contactos con consentimiento. La activación también requiere que el servicio de WhatsApp y su programación estén configurados.</p>
        {failures.data?.length ? <section><div className="admin-panel-heading"><h2>Últimos fallos</h2><span>Revisión manual</span></div><ul className="admin-list">{failures.data.map((failure) => <li key={failure.id}><span>{failure.last_error === "delivery_unknown" ? "Resultado incierto · requiere revisión manual" : failure.last_error ?? "Error de envío"}</span><time dateTime={failure.created_at}>{new Date(failure.created_at).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}</time></li>)}</ul></section> : null}
      </details>
      <details className="admin-whatsapp-disclosure">
        <summary>Historial de configuración<span>Últimos {audit.data?.length ?? 0} cambios</span></summary>
        {audit.data?.length ? <ul className="admin-list">{audit.data.map((entry) => <li key={entry.id}><div><strong>{entry.details.previous?.enabled !== entry.details.enabled ? entry.details.enabled ? "Envíos activados" : "Envíos desactivados" : "Plantilla actualizada"}</strong><p>Administrador: {entry.actor_email ?? "Cuenta eliminada"}</p></div><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</time></li>)}</ul> : <p className="admin-context-note">Todavía no hay cambios registrados.</p>}
      </details>
    </div>
  </div>;
}
export default function Page() { return <Suspense fallback={<AdminLoading />}><Whatsapp /></Suspense>; }
