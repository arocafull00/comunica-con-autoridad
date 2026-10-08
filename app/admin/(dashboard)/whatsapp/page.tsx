import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { WhatsappForm, type Template } from "../../whatsapp-form";
import { Badge } from "@/components/ui/badge";
import { AdminLoading } from "../../loading-state";
import { Pause, Check } from "lucide-react";
async function Whatsapp() {
  const { db } = await requireAdmin();
  const [settings, templates, audit, failures, ...counts] = await Promise.all([
    db.from("whatsapp_settings").select("enabled,template_id,revision,updated_at").single(),
    db.from("whatsapp_templates").select("id,name,language,body,approved,verified_at").order("name"),
    db.from("admin_audit").select("id,details,created_at,actor_email").order("created_at", { ascending: false }).limit(10),
    db.from("whatsapp_messages").select("id,last_error,created_at,leads!inner(source)").eq("leads.source", "web").eq("status", "failed").order("created_at", { ascending: false }).limit(10),
    ...["pending", "processing", "sent", "failed"].map((status) => db.from("whatsapp_messages").select("id,leads!inner(source)", { count: "exact", head: true }).eq("leads.source", "web").eq("status", status)),
  ]);
  if ([settings, templates, audit, failures, ...counts].some((r) => r.error) || !settings.data) throw new Error("No se pudo consultar WhatsApp.");
  return <div className="admin-page admin-whatsapp"><div className="admin-page-heading"><div><h1>WhatsApp</h1><p className="admin-muted">Bienvenida y estado de los mensajes</p></div><Badge variant="outline" className={`admin-badge ${settings.data.enabled ? "admin-badge-enabled" : ""}`}>{settings.data.enabled ? <Check size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{settings.data.enabled ? "Activada en el panel" : "Pausada en el panel"}</Badge></div><dl className="admin-stats admin-inline-stats admin-message-stats">{["Pendientes", "Procesando", "Aceptados por Meta", "Fallidos"].map((name, i) => <div key={name}><dt>{name}</dt><dd className={i === 3 && counts[i].count ? "admin-error-count" : undefined}>{counts[i].count ?? 0}</dd></div>)}</dl><details className="admin-chart-note"><summary>Qué significan estos estados</summary><p>“Aceptado por Meta” confirma la aceptación del envío. Esta versión no mide entrega ni lectura. La activación también requiere que el servicio de WhatsApp y su programación estén configurados.</p></details>
    <WhatsappForm templates={(templates.data ?? []) as Template[]} settings={settings.data} />
    <div className="admin-operations-grid"><section><div className="admin-panel-heading"><h2>Últimos fallos</h2><span>Revisión manual</span></div>{failures.data?.length ? <ul className="admin-list">{failures.data.map((failure) => <li key={failure.id}><span>{failure.last_error === "delivery_unknown" ? "Resultado incierto · requiere revisión manual" : failure.last_error ?? "Error de envío"}</span><time dateTime={failure.created_at}>{new Date(failure.created_at).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}</time></li>)}</ul> : <p className="admin-context-note">No hay mensajes fallidos.</p>}</section>
    <section><div className="admin-panel-heading"><h2>Historial de configuración</h2><span>Últimos 10 cambios</span></div>{audit.data?.length ? <ul className="admin-list">{audit.data.map((entry) => <li key={entry.id}><div><strong>{entry.details.enabled ? "Envíos activados" : "Envíos pausados"}</strong><p>Administrador: {entry.actor_email ?? "Cuenta eliminada"}</p></div><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</time></li>)}</ul> : <p className="admin-context-note">Todavía no hay cambios registrados.</p>}</section></div>
  </div>;
}
export default function Page() { return <Suspense fallback={<AdminLoading label="Cargando WhatsApp…" />}><Whatsapp /></Suspense>; }
