"use client";
import { useActionState, useEffect, useState } from "react";
import { Copy, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nextTemplateName, validWelcomeBody } from "@/lib/whatsapp-template-version";
import { createWhatsappTemplateVersion } from "./whatsapp-version-action";
import type { Template } from "./whatsapp-form";

type EditorProps = { source: Template; templates: Template[]; busy: boolean; onPendingChange: (pending: boolean) => void };

export function WhatsappVersionEditor(props: EditorProps) {
  const { source, busy } = props;
  const [open, setOpen] = useState(false);
  const supported = ["UTILITY", "MARKETING"].includes(source.category) && source.meta_status !== "UNAVAILABLE" &&
    source.components.length === 1 && source.components[0]?.type === "BODY" && validWelcomeBody(source.body);
  if (!supported) return <p className="admin-muted">{source.category === "UNKNOWN" ? "Sincroniza con Meta para cargar los datos necesarios para crear una nueva versión." : "El editor de bienvenida admite texto fijo o una única variable {{1}} para el nombre, sin cabeceras, pies ni botones."}</p>;
  if (!open) return <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(true)}><Copy size={16} aria-hidden="true" />Crear nueva versión</Button>;
  return <VersionForm {...props} onClose={() => setOpen(false)} />;
}

function VersionForm({ source, templates, busy, onPendingChange, onClose }: EditorProps & { onClose: () => void }) {
  const [name, setName] = useState(() => nextTemplateName(source.name, templates.map((t) => t.name)));
  const [body, setBody] = useState(source.body);
  const [state, action, pending] = useActionState(createWhatsappTemplateVersion, { message: "" });
  useEffect(() => { onPendingChange(pending); return () => onPendingChange(false); }, [pending, onPendingChange]);
  const duplicate = templates.some((t) => t.name === name);
  const valid = /^[a-z0-9_]{1,512}$/.test(name) && validWelcomeBody(body) && !duplicate && body !== source.body;
  return <section className="admin-version-editor" aria-labelledby="whatsapp-version-title">
    <div className="admin-panel-heading"><h2 id="whatsapp-version-title">Crear nueva versión</h2><Button type="button" variant="ghost" disabled={pending} onClick={onClose} aria-label="Cerrar editor"><X size={18} aria-hidden="true" /></Button></div>
    <p className="admin-muted">Se creará una plantilla nueva a partir de «{source.name}». La original seguirá seleccionada si ya está en uso. La nueva solo se usará cuando esté aprobada y la guardes como plantilla de bienvenida.</p>
    <p className="admin-muted">Idioma: {source.language} · categoría: {source.category === "UTILITY" ? "Utilidad" : "Marketing"}</p>
    <form action={action} className="admin-form">
      <fieldset disabled={busy || pending || !!state.success}>
        <input type="hidden" name="sourceId" value={source.id} />
        <Label htmlFor="whatsapp-version-name">Nombre de la nueva versión</Label>
        <Input id="whatsapp-version-name" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={512} pattern="[a-z0-9_]+" required aria-describedby="whatsapp-version-name-note" />
        <p id="whatsapp-version-name-note" className="admin-muted">{duplicate ? "Este nombre ya existe. Elige uno distinto." : "Minúsculas, números y guiones bajos. El nombre debe ser distinto al de la plantilla original."}</p>
        <Label htmlFor="whatsapp-version-body">Mensaje de la nueva versión</Label>
        <textarea id="whatsapp-version-body" className="admin-version-body" name="body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024} rows={5} required aria-describedby="whatsapp-version-body-note" />
        <p id="whatsapp-version-body-note" className="admin-muted">{body.length}/1024 caracteres · texto fijo o una única variable {"{{1}}"} para el nombre.</p>
        <div className="admin-message" aria-label="Vista previa de la nueva versión"><p>{body.replace("{{1}}", "María")}</p></div>
        <Button type="submit" disabled={!valid || pending}><Send size={16} aria-hidden="true" />{pending ? "Enviando a Meta…" : "Enviar nueva versión a Meta"}</Button>
      </fieldset>
      {state.message ? <p role="status" className={state.success ? "admin-success" : "admin-error"}>{state.message}</p> : null}
    </form>
  </section>;
}
