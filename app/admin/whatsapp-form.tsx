"use client";

import { useActionState, useState } from "react";
import { AlertDialog } from "radix-ui";
import { Check, MessageCircle, Pause, Play, RefreshCw, Save } from "lucide-react";
import { saveWhatsappSettings } from "./actions";
import { syncWhatsappTemplates } from "./whatsapp-sync-action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export type Template = { id: string; name: string; language: string; body: string; approved: boolean; meta_status: string; verified_at: string };

function templateStatus(status: string) {
  const labels: Record<string, string> = { APPROVED: "Aprobada", PENDING: "Pendiente de aprobación", REJECTED: "Rechazada", PAUSED: "Pausada", DISABLED: "Deshabilitada", IN_APPEAL: "En revisión de recurso", PENDING_DELETION: "Pendiente de eliminación", DELETED: "Eliminada", UNAVAILABLE: "Ya no está en Meta" };
  return labels[status] ?? `No aprobada · ${status}`;
}

export function WhatsappForm({ templates, settings }: { templates: Template[]; settings: { enabled: boolean; template_id: string | null; revision: number } }) {
  const approved = templates.filter((t) => t.approved);
  const [selected, setSelected] = useState(approved.some((t) => t.id === settings.template_id) ? settings.template_id! : "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [state, action, pending] = useActionState(saveWhatsappSettings, { message: "" });
  const [deliveryState, deliveryAction, changingDelivery] = useActionState(async (previous: { message: string; success?: boolean }, form: FormData) => {
    const result = await saveWhatsappSettings(previous, form);
    if (result.success) setConfirmOpen(false);
    return result;
  }, { message: "" });
  const [syncState, syncAction, syncing] = useActionState(syncWhatsappTemplates, { message: "" });
  const template = templates.find((t) => t.id === selected);
  const savedTemplate = approved.find((t) => t.id === settings.template_id);
  const changed = !!template?.approved && template.id !== settings.template_id;
  const busy = pending || syncing || changingDelivery;

  return <div className="admin-whatsapp-settings">
    <div className="admin-delivery-bar">
      <div>
        <h2>Envíos de bienvenida</h2>
        <p className={`admin-delivery-status ${settings.enabled ? "is-enabled" : ""}`}>
          {settings.enabled ? <Check size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          {settings.enabled ? "Activados en el panel" : "Desactivados en el panel"}
        </p>
        {!settings.enabled && !savedTemplate ? <p className="admin-muted">Guarda una plantilla para poder activar los envíos.</p> : null}
      </div>
      <AlertDialog.Root open={confirmOpen} onOpenChange={(open) => { if (!changingDelivery) setConfirmOpen(open); }}>
        <AlertDialog.Trigger asChild>
          <Button type="button" variant={settings.enabled ? "outline" : "default"} disabled={busy || (!settings.enabled && !savedTemplate)}>
            {settings.enabled ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            {settings.enabled ? "Desactivar envíos" : "Activar envíos"}
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="admin-confirm-overlay" />
          <AlertDialog.Content className="admin-root admin-confirm-dialog">
            <AlertDialog.Title asChild><h2>¿Deseas {settings.enabled ? "desactivar" : "activar"} los envíos de bienvenida?</h2></AlertDialog.Title>
            <AlertDialog.Description asChild>
              <p className="admin-muted">{settings.enabled ? "Se detendrán los próximos envíos. Un mensaje ya iniciado puede terminar de enviarse." : `Se usará la plantilla guardada «${savedTemplate?.name}» para los contactos con consentimiento, incluidos los mensajes pendientes.`}</p>
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

    <form id="whatsapp-template-sync" action={syncAction} />
    <form action={action} className="admin-form admin-whatsapp-form">
      <fieldset disabled={busy}>
        <input type="hidden" name="intent" value="template" />
        <input type="hidden" name="revision" value={settings.revision} />
        <div className="admin-whatsapp-controls">
          <h2>Mensaje de bienvenida</h2>
          <p className="admin-muted">Selecciona una plantilla para revisar el mensaje antes de guardarlo.</p>
          <Label htmlFor="whatsapp-template">Plantillas de Meta</Label>
          <div className="admin-template-row">
            <NativeSelect id="whatsapp-template" name="templateId" value={template?.id ?? ""} onChange={(e) => setSelected(e.target.value)}><NativeSelectOption value="">Selecciona una plantilla</NativeSelectOption>{templates.map((t) => <NativeSelectOption key={t.id} value={t.id}>{t.name} · {t.language} · {templateStatus(t.meta_status)}{t.meta_status === "APPROVED" && !t.approved ? " · No compatible con bienvenida" : ""}</NativeSelectOption>)}</NativeSelect>
            <Button type="submit" form="whatsapp-template-sync" variant="outline"><RefreshCw size={16} aria-hidden="true" />{syncing ? "Sincronizando…" : "Sincronizar con Meta"}</Button>
          </div>
          {syncState.message ? <p role="status" className={syncState.success ? "admin-success" : "admin-error"}>{syncState.message}</p> : null}
          {!templates.length ? <Alert className="admin-notice"><AlertDescription>No hay plantillas sincronizadas. Sincroniza con Meta para actualizar el catálogo.</AlertDescription></Alert> : !approved.length ? <Alert className="admin-notice"><AlertDescription>Puedes revisar todas las plantillas. Para los envíos de bienvenida hace falta una aprobada y compatible.</AlertDescription></Alert> : null}
        </div>
        {template ? <section key={template.id} className="admin-preview t-panel-slide" data-open="true" aria-label="Vista previa del mensaje">
          <div className="admin-preview-header"><MessageCircle size={18} aria-hidden="true" /><h3>Vista previa</h3></div>
          <div className="admin-template-status">
            <Badge variant={template.meta_status === "REJECTED" ? "destructive" : "outline"}>{templateStatus(template.meta_status)}</Badge>
            {template.meta_status === "APPROVED" && !template.approved ? <Badge variant="secondary">No compatible con bienvenida</Badge> : null}
          </div>
          <div className="admin-message"><p>{template.body ? template.approved ? template.body.replace("{{1}}", "María") : template.body : "Esta plantilla no tiene cuerpo de texto."}</p></div>
          <p className="admin-muted">{template.approved ? "Nombre de ejemplo: María · " : ""}Idioma: {template.language}</p>
          {!template.approved ? <p className="admin-muted">{template.meta_status === "APPROVED" ? "Este formato necesita parámetros o componentes que el envío de bienvenida todavía no admite." : "Esta plantilla no se puede usar para enviar la bienvenida mientras no esté aprobada por Meta."}</p> : null}
        </section> : null}
        {changed ? <div className="admin-template-save">
          <p className="admin-muted">{settings.enabled ? "Esta plantilla se usará en los próximos envíos al guardarla." : "Guardar la plantilla no activa los envíos."}</p>
          <Button type="submit" disabled={busy}><Save size={16} aria-hidden="true" />{pending ? "Guardando…" : "Guardar plantilla"}</Button>
        </div> : null}
      </fieldset>
      {state.message ? <p role="status" className={state.success ? "admin-success" : "admin-error"}>{state.message}</p> : null}
    </form>
  </div>;
}
