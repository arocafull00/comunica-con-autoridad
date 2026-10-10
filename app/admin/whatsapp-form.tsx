import Image from "next/image";
import { Check, Pause } from "lucide-react";
import { fixedWhatsappTemplates, whatsappAutomations, type WhatsappAutomation } from "@/lib/followups/whatsapp-automations";
import { staticUrlButtons } from "@/lib/whatsapp-template-compatibility";
import { Badge } from "@/components/ui/badge";
import { WhatsappTemplateToolbar } from "./whatsapp-template-toolbar";

const metaManagerUrl = "https://business.facebook.com/latest/whatsapp_manager/message_templates/?business_id=1102523378841182&asset_id=1407248797600706&tab=message-templates";

function templateStatus(status: string | null) {
  const labels: Record<string, string> = { APPROVED: "Aprobada", PENDING: "Pendiente de aprobación", REJECTED: "Rechazada", PAUSED: "Pausada", DISABLED: "Deshabilitada", IN_APPEAL: "En revisión de recurso", PENDING_DELETION: "Pendiente de eliminación", DELETED: "Eliminada", UNAVAILABLE: "Ya no está en Meta" };
  return status ? labels[status] ?? `Estado: ${status}` : "Pendiente de sincronización";
}

export function WhatsappOverview({ automations, settings }: { automations: WhatsappAutomation[]; settings: { enabled: boolean } }) {
  const readyCount = automations.filter((t) => t.ready).length;
  return <div className="admin-whatsapp-settings">
    <WhatsappTemplateToolbar metaManagerUrl={metaManagerUrl} />
    <details className="admin-whatsapp-disclosure admin-whatsapp-templates">
      <summary>Plantillas de WhatsApp<span>{whatsappAutomations.length} plantillas</span></summary>
    {([{ key: "booking", title: "Si reservan la llamada" }, { key: "webinar", title: "Si no reservan la llamada" }] as const).map((group) => <section key={group.key} className="admin-automation-group" aria-labelledby={`whatsapp-${group.key}`}>
      <h2 id={`whatsapp-${group.key}`}>{group.title}</h2>
      <div className="admin-template-grid">
        {whatsappAutomations.filter((definition) => definition.group === group.key).map((definition) => {
          const template = automations.find((t) => t.key === definition.key);
          const fixed = fixedWhatsappTemplates[definition.key];
          const components = template?.components ?? [];
          const header = components.find((c) => c.type === "HEADER");
          const imageUrl = header?.format === "IMAGE" ? header.example?.header_handle?.[0] : null;
          const footer = components.find((c) => c.type === "FOOTER")?.text;
          const variable = template?.parameter === "name" ? "[Nombre del registro]" : template?.parameter === "meetingUrl" ? "[Enlace de Meet]" : "{{1}}";
          return <article key={definition.key} className="admin-template-card" data-automation={definition.key} aria-labelledby={`template-${definition.key}`}>
            <div className="admin-template-card-status"><Badge variant="outline" data-status={template?.meta_status ?? "MISSING"}>{templateStatus(template?.meta_status ?? null)}</Badge></div>
            <h3 id={`template-${definition.key}`}>{definition.title}</h3>
            <p className="admin-template-trigger">{definition.trigger}</p>
            <div className="admin-template-content">
              {imageUrl ? <Image className="admin-template-image" src={imageUrl} alt={`Imagen de ${definition.title}`} width={600} height={400} unoptimized /> : null}
              {header?.text ? <p className="admin-template-header">{header.text}</p> : null}
              <p>{template?.body ? template.body.replaceAll("{{1}}", variable) : "El contenido aparecerá cuando se consulte el catálogo de Meta."}</p>
              {footer ? <p className="admin-template-meta">{footer}</p> : null}
              {staticUrlButtons(components).map((button, i) => <p className="admin-template-meta" key={i}>Botón: {button.text}<br />{button.url}</p>)}
            </div>
            <div className="admin-template-card-footer">
              {template?.parameter ? <p className="admin-template-meta">Variable: {template.parameter === "name" ? "nombre del registro" : "enlace real de Meet"}</p> : null}
              <p className="admin-template-meta">Meta: {fixed.name} · {fixed.language}</p>
              {template?.ready ? <p className="admin-template-in-use"><Check size={16} aria-hidden="true" />Lista para su trigger</p> : null}
            </div>
          </article>;
        })}
      </div>
    </section>)}
    <p className="admin-context-note">Al recibir «CONFIRMO» por el webhook se registra la asistencia en el panel si hay una única llamada futura asociada al teléfono. «BAJA» o «STOP» retiran el consentimiento de WhatsApp. El administrador revisa las respuestas ambiguas y gestiona las cancelaciones en Cal.com.</p>
    </details>
    <div className="admin-delivery-bar">
      <div>
        <h2>Envíos automáticos</h2>
        <p className={`admin-delivery-status ${settings.enabled ? "is-enabled" : ""}`}>
          {settings.enabled ? <Check size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          {settings.enabled ? "Habilitados en la configuración del servicio" : "Pausados en la configuración del servicio"}
        </p>
        <p className="admin-muted">{readyCount} de {whatsappAutomations.length} plantillas aprobadas para sus triggers.</p>
      </div>
    </div>
  </div>;
}
