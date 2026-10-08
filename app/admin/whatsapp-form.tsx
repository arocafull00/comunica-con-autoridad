"use client";
import { useActionState, useState } from "react";
import { MessageCircle, Save } from "lucide-react";
import { saveWhatsappSettings } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
export type Template = { id: string; name: string; language: string; body: string; approved: boolean; verified_at: string };
export function WhatsappForm({ templates, settings }: { templates: Template[]; settings: { enabled: boolean; template_id: string | null; revision: number } }) {
  const approved = templates.filter((t) => t.approved);
  const [selected, setSelected] = useState(approved.some((t) => t.id === settings.template_id) ? settings.template_id! : "");
  const [state, action, pending] = useActionState(saveWhatsappSettings, { message: "" });
  const template = approved.find((t) => t.id === selected);
  return <form action={action} className="admin-form admin-whatsapp-form"><fieldset disabled={pending}>
    <input type="hidden" name="revision" value={settings.revision} />
    <div className="admin-whatsapp-grid"><div className="admin-whatsapp-controls">
      <h2>Mensaje de bienvenida</h2><p className="admin-muted">Elige qué recibirá quien solicite la confirmación por WhatsApp.</p>
      <Label htmlFor="whatsapp-template">Plantilla aprobada</Label><NativeSelect id="whatsapp-template" name="templateId" value={selected} disabled={pending} onChange={(e) => setSelected(e.target.value)}><NativeSelectOption value="">Selecciona una plantilla</NativeSelectOption>{approved.map((t) => <NativeSelectOption key={t.id} value={t.id}>{t.name} · {t.language}</NativeSelectOption>)}</NativeSelect>
      {!approved.length ? <Alert className="admin-notice"><AlertDescription>Todavía no hay plantillas aprobadas registradas. El responsable de la web debe sincronizarlas desde Meta.</AlertDescription></Alert> : null}
    </div><div className="admin-preview"><div className="admin-preview-header"><MessageCircle size={20} aria-hidden="true" /><h2>Vista previa</h2></div>
      <div className="admin-message"><p>{template ? template.body.replace("{{1}}", "María") : "Selecciona una plantilla para ver el mensaje."}</p></div>
      <p className="admin-muted">{template ? `Parámetro de nombre: María · idioma: ${template.language}` : "El nombre se personalizará con los datos de cada solicitud."}</p>
      <p className="admin-muted">Solo se envía a contactos que hayan dado su consentimiento.</p>
    </div><div className="admin-whatsapp-activation">
      <div className="admin-toggle"><Switch id="whatsapp-enabled" name="enabled" value="on" defaultChecked={settings.enabled} disabled={pending} /><Label htmlFor="whatsapp-enabled">Activar los envíos de bienvenida</Label></div>
      <p className="admin-muted">La pausa detiene los próximos envíos. Un envío ya iniciado puede terminar. Al reactivar se procesarán los mensajes pendientes con consentimiento.</p>
      <Button type="submit" disabled={pending}><Save size={16} aria-hidden="true" />{pending ? "Guardando…" : "Guardar configuración"}</Button>
    </div></div>
  </fieldset><p role="status" className={state.success ? "admin-success" : "admin-error"}>{state.message}</p></form>;
}
