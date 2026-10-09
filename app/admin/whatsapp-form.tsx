"use client";

import { useActionState, useState } from "react";
import { AlertDialog } from "radix-ui";
import { Check, ExternalLink, Pause, Play, RefreshCw } from "lucide-react";
import { whatsappAutomations, type WhatsappAutomation } from "@/lib/followups/whatsapp-automations";
import { saveWhatsappSettings } from "./actions";
import { syncWhatsappTemplates } from "./whatsapp-sync-action";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const metaManagerUrl = "https://business.facebook.com/latest/whatsapp_manager/message_templates/?business_id=1102523378841182&tab=message-templates&filters=%7B%22date_range%22%3A7%2C%22language%22%3A%5B%5D%2C%22quality%22%3A%5B%5D%2C%22search_text%22%3A%22%22%2C%22status%22%3A%5B%22APPROVED%22%2C%22IN_APPEAL%22%2C%22PAUSED%22%2C%22PENDING%22%2C%22REJECTED%22%5D%2C%22tag%22%3A%5B%5D%7D&nav_ref=whatsapp_manager&asset_id=1407248797600706";

function templateStatus(status: string | null) {
  const labels: Record<string, string> = { APPROVED: "Aprobada", PENDING: "Pendiente de aprobación", REJECTED: "Rechazada", PAUSED: "Pausada", DISABLED: "Deshabilitada", IN_APPEAL: "En revisión de recurso", PENDING_DELETION: "Pendiente de eliminación", DELETED: "Eliminada", UNAVAILABLE: "Ya no está en Meta" };
  return status ? labels[status] ?? `Estado: ${status}` : "Sin plantilla vinculada";
}

export function WhatsappForm({ automations, settings }: { automations: WhatsappAutomation[]; settings: { enabled: boolean; revision: number } }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deliveryState, deliveryAction, changingDelivery] = useActionState(async (previous: { message: string; success?: boolean }, form: FormData) => {
    const result = await saveWhatsappSettings(previous, form);
    if (result.success) setConfirmOpen(false);
    return result;
  }, { message: "" });
  const [syncState, syncAction, syncing] = useActionState(syncWhatsappTemplates, { message: "" });
  const readyCount = automations.filter((t) => t.ready).length;
  const busy = syncing || changingDelivery;

  return <div className="admin-whatsapp-settings">
    <div className="admin-template-toolbar">
      <p className="admin-muted">Cada mensaje tiene un trigger fijo. Consulta su contenido y el estado de su plantilla en Meta.</p>
      <div className="admin-template-toolbar-actions">
        <form action={syncAction}><Button type="submit" variant="outline" disabled={busy}><RefreshCw size={16} aria-hidden="true" />{syncing ? "Sincronizando…" : "Sincronizar con Meta"}</Button></form>
        <Button asChild><a href={metaManagerUrl} target="_blank" rel="noopener noreferrer">Gestionar en Meta<ExternalLink size={16} aria-hidden="true" /></a></Button>
      </div>
    </div>
    {syncState.message ? <p role="status" className={syncState.success ? "admin-success" : "admin-error"}>{syncState.message}</p> : null}
    {([{ key: "booking", title: "Si reservan la llamada" }, { key: "webinar", title: "Si no reservan la llamada" }] as const).map((group) => <section key={group.key} className="admin-automation-group" aria-labelledby={`whatsapp-${group.key}`}>
      <h2 id={`whatsapp-${group.key}`}>{group.title}</h2>
      {group.key === "booking" ? <p className="admin-context-note">A menos de 2 horas de la llamada solo se programa el aviso de 15 minutos. Los otros mensajes se marcan como «No han hecho falta».</p> : <p className="admin-context-note">Los tiempos parten de la inscripción. Reservar detiene esta secuencia; responder detiene el cierre del tercer día.</p>}
      <div className="admin-template-grid">
        {whatsappAutomations.filter((definition) => definition.group === group.key).map((definition) => {
          const template = automations.find((t) => t.key === definition.key);
          return <article key={definition.key} className="admin-template-card" data-automation={definition.key} aria-labelledby={`template-${definition.key}`}>
            <div className="admin-template-card-status"><Badge variant="outline" data-status={template?.meta_status ?? "MISSING"}>{templateStatus(template?.meta_status ?? null)}</Badge></div>
            <h3 id={`template-${definition.key}`}>{definition.title}</h3>
            <p className="admin-template-trigger">{definition.trigger}</p>
            <div className="admin-template-content"><p>{template?.body.replace("{{name}}", "[Nombre del registro]").replace("{{meetingUrl}}", "[Enlace de Meet]") ?? "El mensaje todavía no está configurado."}</p></div>
            <div className="admin-template-card-footer">
              {template?.parameter ? <p className="admin-template-meta">Variable: {template.parameter === "name" ? "nombre del registro" : "enlace real de Meet"}</p> : null}
              <p className="admin-template-meta">{template?.template_name ? `Meta: ${template.template_name} · ${template.language}` : "Crea este mensaje en Meta y sincroniza para vincularlo."}</p>
              {template?.ready ? <p className="admin-template-in-use"><Check size={16} aria-hidden="true" />Lista para su trigger</p> : template?.meta_status === "APPROVED" ? <p className="admin-template-meta">El contenido o formato de Meta no coincide con este mensaje fijo.</p> : null}
            </div>
          </article>;
        })}
      </div>
    </section>)}
    <p className="admin-context-note">La confirmación automática con «CONFIRMO» está pausada. El administrador revisa las respuestas y cancela las plazas manualmente en Cal.com.</p>
    <div className="admin-delivery-bar">
      <div>
        <h2>Envíos automáticos</h2>
        <p className={`admin-delivery-status ${settings.enabled ? "is-enabled" : ""}`}>
          {settings.enabled ? <Check size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          {settings.enabled ? "Activados en el panel" : "Desactivados en el panel"}
        </p>
        <p className="admin-muted">{readyCount} de {whatsappAutomations.length} mensajes listos para enviar.</p>
        {!readyCount ? <p className="admin-muted">Sincroniza con Meta para comprobar las plantillas aprobadas de cada automatización.</p> : null}
      </div>
      <AlertDialog.Root open={confirmOpen} onOpenChange={(open) => { if (!changingDelivery) setConfirmOpen(open); }}>
        <AlertDialog.Trigger asChild>
          <Button type="button" variant={settings.enabled ? "outline" : "default"} disabled={busy || (!settings.enabled && !readyCount)}>
            {settings.enabled ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            {settings.enabled ? "Desactivar envíos" : "Activar envíos"}
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="admin-confirm-overlay" />
          <AlertDialog.Content className="admin-root admin-confirm-dialog">
            <AlertDialog.Title asChild><h2>¿Deseas {settings.enabled ? "desactivar" : "activar"} los envíos automáticos?</h2></AlertDialog.Title>
            <AlertDialog.Description asChild>
              <p className="admin-muted">{settings.enabled ? "Se detendrán los próximos envíos. Un mensaje ya iniciado puede terminar de enviarse." : `Se enviarán los ${readyCount} mensajes listos cuando se cumpla su trigger, a contactos con consentimiento. Los demás esperarán a tener su plantilla aprobada. Los mensajes cuyo horario haya vencido no se enviarán.`}</p>
            </AlertDialog.Description>
            <form action={deliveryAction}>
              <input type="hidden" name="intent" value="delivery" />
              <input type="hidden" name="revision" value={settings.revision} />
              <input type="hidden" name="enabled" value={settings.enabled ? "off" : "on"} />
              {deliveryState.message && !deliveryState.success ? <p role="alert" className="admin-error">{deliveryState.message}</p> : null}
              <div className="admin-confirm-actions">
                <AlertDialog.Cancel asChild><Button type="button" variant="outline" disabled={changingDelivery}>Cancelar</Button></AlertDialog.Cancel>
                <Button type="submit" disabled={changingDelivery}>{changingDelivery ? "Aplicando…" : settings.enabled ? "Desactivar envíos" : "Activar envíos"}</Button>
              </div>
            </form>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
    {deliveryState.success ? <p role="status" className="admin-success">{deliveryState.message}</p> : null}

  </div>;
}
