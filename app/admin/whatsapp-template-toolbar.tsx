"use client";

import { useActionState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncWhatsappTemplates } from "./whatsapp-sync-action";

export function WhatsappTemplateToolbar({ metaManagerUrl }: { metaManagerUrl: string }) {
  const [state, action, pending] = useActionState(syncWhatsappTemplates, { message: "" });

  return <>
    <div className="admin-template-toolbar">
      <div className="admin-template-toolbar-actions">
        <form action={action}>
          <Button type="submit" variant="outline" disabled={pending}>
            <RefreshCw size={16} aria-hidden="true" />{pending ? "Sincronizando…" : "Sincronizar con Meta"}
          </Button>
        </form>
        <Button asChild variant="outline"><a href={metaManagerUrl} target="_blank" rel="noopener noreferrer">Consultar en Meta<ExternalLink size={16} aria-hidden="true" /></a></Button>
      </div>
    </div>
    {state.message ? <p role="status" className={state.success ? "admin-success" : "admin-error"}>{state.message}</p> : null}
  </>;
}
