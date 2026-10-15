"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { Check, Copy, Megaphone, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { campaignLink, normalizeUtm, type Campaign, type CampaignSuggestions } from "@/lib/admin/campaigns";
import { deleteCampaign, saveCampaign } from "./campaign-actions";

const subscribe = () => () => {};
const useOrigin = () => useSyncExternalStore(subscribe, () => window.location.origin, () => "");
const format = (value: number) => new Intl.NumberFormat("es-ES").format(value);

function CopyButton({ link, label = "Copiar enlace" }: { link: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return <Button type="button" variant="outline" onClick={copy} disabled={!link}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? "Copiado" : label}</Button>;
}

export function CampaignLinkBuilder({ suggestions }: { suggestions: CampaignSuggestions }) {
  const origin = useOrigin();
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [state, action, pending] = useActionState(saveCampaign, { message: "" });

  const values = { utm_source: normalizeUtm(source), utm_medium: normalizeUtm(medium), utm_campaign: normalizeUtm(campaign) };
  const ready = Object.values(values).every(Boolean);
  const link = ready && origin ? campaignLink(origin, values) : "";

  const field = (id: keyof CampaignSuggestions, name: keyof typeof values, label: string, value: string, set: (v: string) => void, placeholder: string) => <label htmlFor={`campaign-${id}`}>{label}
    <Input id={`campaign-${id}`} name={name} list={`campaign-${id}-options`} value={value} placeholder={placeholder} maxLength={100} autoComplete="off" required onChange={(e) => set(e.target.value)} />
    <datalist id={`campaign-${id}-options`}>{suggestions[id].map((option) => <option key={option} value={option} />)}</datalist>
  </label>;

  return <div className="admin-campaign-builder">
    <form className="admin-form" id="campaign-form" action={action}>
      {field("sources", "utm_source", "Fuente (utm_source)", source, setSource, "instagram")}
      {field("mediums", "utm_medium", "Medio (utm_medium)", medium, setMedium, "paid")}
      {field("campaigns", "utm_campaign", "Nombre de la campaña (utm_campaign)", campaign, setCampaign, "curso_octubre")}
    </form>
    <section className="admin-campaign-result" aria-labelledby="campaign-link-heading">
      <h2 id="campaign-link-heading">Enlace de la campaña</h2>
      {link ? <>
        <p className="admin-campaign-link">{link}</p>
        <div className="admin-campaign-actions">
          <Button type="submit" form="campaign-form" disabled={pending}><Save size={16} aria-hidden="true" />{pending ? "Guardando…" : "Guardar campaña"}</Button>
          <CopyButton link={link} />
        </div>
      </> : <p className="admin-muted">Completa la fuente, el medio y el nombre para generar el enlace.</p>}
      <p role="status" className={state.success ? "admin-success" : "admin-error"}>{state.message}</p>
      <p className="admin-muted">Se usan minúsculas, sin tildes ni espacios, para que la misma campaña no aparezca dividida en el resumen. No incluyas datos personales.</p>
    </section>
  </div>;
}

export function SavedCampaigns({ campaigns }: { campaigns: Campaign[] }) {
  const origin = useOrigin();
  return <section className="admin-report admin-saved-campaigns" aria-labelledby="saved-campaigns-heading">
    <div className="admin-panel-heading"><h2 id="saved-campaigns-heading">Campañas guardadas</h2><span>{format(campaigns.length)} campañas</span></div>
    {campaigns.length ? <ul className="admin-list">{campaigns.map((campaign) => {
      const link = origin ? campaignLink(origin, campaign) : "";
      return <li key={campaign.id}>
        <div className="admin-campaign-detail">
          <strong>{campaign.utm_campaign}</strong>
          <p>{campaign.utm_source} · {campaign.utm_medium} · {format(campaign.leads)} solicitudes</p>
          <p className="admin-campaign-link">{link}</p>
        </div>
        <div className="admin-campaign-actions">
          <CopyButton link={link} label="Copiar" />
          <form action={deleteCampaign} onSubmit={(e) => { if (!confirm(`¿Eliminar la campaña «${campaign.utm_campaign}»? Las solicitudes ya recibidas no se borran.`)) e.preventDefault(); }}>
            <input type="hidden" name="id" value={campaign.id} />
            <Button type="submit" variant="ghost" aria-label={`Eliminar ${campaign.utm_campaign}`}><Trash2 size={16} aria-hidden="true" /></Button>
          </form>
        </div>
      </li>;
    })}</ul> : <div className="admin-empty"><Megaphone size={24} aria-hidden="true" /><strong>Aún no hay campañas guardadas</strong><p>Genera un enlace arriba y pulsa «Guardar campaña».</p></div>}
  </section>;
}
