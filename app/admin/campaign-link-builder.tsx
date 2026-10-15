"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { Check, ChevronsUpDown, Copy, Megaphone, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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

function CampaignCombobox({ id, name, value, onChange, options, placeholder }: { id: string; name: string; value: string; onChange: (value: string) => void; options: string[]; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const custom = normalizeUtm(search);
  function choose(option: string) {
    onChange(option);
    setOpen(false);
    setSearch("");
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="admin-combobox-trigger justify-between font-normal">
        {value || <span className="text-muted-foreground">{placeholder}</span>}
        <ChevronsUpDown className="opacity-50" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <input type="hidden" name={name} value={value} />
    <PopoverContent className="admin-root dark admin-combobox-popover p-0" align="start">
      <Command>
        <CommandInput placeholder="Buscar o escribir uno nuevo…" value={search} onValueChange={setSearch} maxLength={100} />
        <CommandList>
          <CommandEmpty>Escribe un valor para usarlo.</CommandEmpty>
          {custom && !options.includes(custom) ? <CommandGroup><CommandItem value={`nuevo ${custom}`} onSelect={() => choose(custom)} forceMount><Plus aria-hidden="true" />Usar «{custom}»</CommandItem></CommandGroup> : null}
          <CommandGroup>{options.map((option) => <CommandItem key={option} value={option} onSelect={() => choose(option)}>
            {option}
            <Check className={cn("ml-auto", value === option ? "opacity-100" : "opacity-0")} aria-hidden="true" />
          </CommandItem>)}</CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}

export function CampaignLinkBuilder({ suggestions }: { suggestions: CampaignSuggestions }) {
  const origin = useOrigin();
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [state, action, pending] = useActionState(saveCampaign, { message: "" });

  const values = { utm_source: source, utm_medium: medium, utm_campaign: campaign };
  const ready = Object.values(values).every(Boolean);
  const link = ready && origin ? campaignLink(origin, values) : "";

  const field = (id: keyof CampaignSuggestions, name: keyof typeof values, label: string, value: string, set: (v: string) => void, placeholder: string) => <label htmlFor={`campaign-${id}`}>
    <span className="admin-campaign-label">{label}<code>{name}</code></span>
    <CampaignCombobox id={`campaign-${id}`} name={name} value={value} onChange={set} options={suggestions[id]} placeholder={placeholder} />
  </label>;

  const part = (name: keyof typeof values, placeholder: string) => <>{name}=<span className={values[name] ? "admin-campaign-value" : "admin-campaign-gap"}>{values[name] || placeholder}</span></>;

  return <form className="admin-campaign-builder" action={action}>
    <div className="admin-campaign-fields">
      {field("sources", "utm_source", "Fuente", source, setSource, "instagram")}
      {field("mediums", "utm_medium", "Medio", medium, setMedium, "paid")}
      {field("campaigns", "utm_campaign", "Campaña", campaign, setCampaign, "curso_octubre")}
    </div>
    <div className="admin-campaign-result">
      <p className="admin-campaign-preview" aria-label="Vista previa del enlace" aria-live="polite">
        <span className="admin-campaign-origin">{origin}/?</span>{part("utm_source", "fuente")}&amp;{part("utm_medium", "medio")}&amp;{part("utm_campaign", "campaña")}
      </p>
      <div className="admin-campaign-actions">
        <CopyButton link={link} />
        <Button type="submit" disabled={!ready || pending}><Save size={16} aria-hidden="true" />{pending ? "Guardando…" : "Guardar"}</Button>
      </div>
    </div>
    <p role="status" className={state.success ? "admin-success" : "admin-error"}>{state.message}</p>
  </form>;
}

export function SavedCampaigns({ campaigns }: { campaigns: Campaign[] }) {
  const origin = useOrigin();
  return <section className="admin-report admin-saved-campaigns" aria-labelledby="saved-campaigns-heading">
    <div className="admin-panel-heading"><h2 id="saved-campaigns-heading">Campañas guardadas</h2>{campaigns.length ? <span>{format(campaigns.length)} {campaigns.length === 1 ? "campaña" : "campañas"}</span> : null}</div>
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
    })}</ul> : <p className="admin-campaign-empty"><Megaphone size={18} aria-hidden="true" />Aún no hay campañas. Las que guardes aparecerán aquí con sus solicitudes.</p>}
  </section>;
}
