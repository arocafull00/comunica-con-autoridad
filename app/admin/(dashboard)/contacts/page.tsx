import { Suspense, type ReactNode } from "react";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { dateRange } from "@/lib/admin/validation";
import { madridMidnight } from "@/lib/admin/traffic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AdminLoading } from "../../loading-state";
import { DateRangeFilter } from "../../date-range-filter";
import { QUALIFICATION_STEP_LABELS } from "@/lib/funnel";
import { PageSizeSelect } from "../../page-size-select";
import { ContactDetailsDialog, type ContactDetailsSection } from "../../contact-details-dialog";

const PAGE_SIZES = [10, 25, 50] as const;
const DRAFT_LABELS: Record<string, string> = { profession: "Profesión", situation: "Situación", goal: "Quiere mejorar", commitment: "Compromiso", investment: "Inversión", applicationReasons: "Razones para reservar" };
const formatDate = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" }).format;
const formatNumber = new Intl.NumberFormat("es-ES").format;

type Lead = { name: string | null; email: string; phone: string | null; created_at: string; whatsapp_consent: boolean; utm_source: string | null; utm_campaign: string | null; profession: string | null; situation: string | null; goal: string | null; commitment: string | null; investment: string | null; application_reasons: string | null; admission_decision: string | null; qualified_at: string | null; qualification_step: number | null; qualification_draft: Record<string, string> | null };

function formStatus(lead: Lead) {
  if (lead.qualified_at) return { tone: "done", label: "Completado", detail: "Formulario completado" };
  if (!lead.qualification_step) return { tone: "idle", label: "Sin empezar", detail: "No ha empezado las preguntas" };
  return { tone: "open", label: `Pregunta ${lead.qualification_step}/${QUALIFICATION_STEP_LABELS.length}`, detail: `Se quedó en la pregunta ${lead.qualification_step} de ${QUALIFICATION_STEP_LABELS.length} · ${QUALIFICATION_STEP_LABELS[lead.qualification_step - 1]}` };
}

function detailSections(lead: Lead): ContactDetailsSection[] {
  const present = (fields: [string, string | null][]) => fields.filter((field): field is [string, string] => Boolean(field[1]));
  const answers = present([["Profesión", lead.profession], ["Situación", lead.situation], ["Quiere mejorar", lead.goal], ["Compromiso", lead.commitment], ["Inversión", lead.investment], ["Razones para reservar", lead.application_reasons], ["Decisión", lead.admission_decision]]);
  const draft = lead.qualified_at ? [] : Object.entries(lead.qualification_draft ?? {}).filter(([field, value]) => DRAFT_LABELS[field] && value).map(([field, value]): [string, string] => [DRAFT_LABELS[field], value]);
  return [
    { title: "Solicitud", fields: [["Fecha", formatDate(new Date(lead.created_at))], ["Fuente", lead.utm_source ?? "Sin fuente"], ["Campaña", lead.utm_campaign ?? "Sin campaña"], ["Teléfono", lead.phone ?? "Pendiente del segundo formulario"], ["WhatsApp", lead.whatsapp_consent ? "Activo" : "Pendiente o retirado"], ["Formulario", formStatus(lead).detail]] },
    ...(answers.length ? [{ title: "Respuestas de la masterclass", fields: answers }] : []),
    ...(draft.length ? [{ title: "Respuestas sin enviar", fields: draft }] : []),
  ];
}

const whatsappUrl = (lead: Lead) => lead.phone ? `https://wa.me/${lead.phone.replace(/\D/g, "")}?text=${encodeURIComponent(lead.name ? `Hola, ${lead.name}. ¿Cómo estás?` : "Hola. ¿Cómo estás?")}` : null;

async function Contacts({ searchParams }: { searchParams: Promise<{ start?: string; end?: string; page?: string; perPage?: string; email?: string }> }) {
  "use cache: private";
  cacheLife({ stale: 60 });
  const params = await searchParams;
  const { db } = await requireAdmin();
  const range = dateRange(params.start, params.end);
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.page) || 1)));
  const perPage = PAGE_SIZES.find((size) => size === Number(params.perPage)) ?? PAGE_SIZES[0];
  const email = (params.email ?? "").trim().slice(0, 254);
  let query = db.from("leads").select("id,name,email,phone,created_at,whatsapp_consent,utm_source,utm_campaign,profession,situation,goal,commitment,investment,application_reasons,admission_decision,qualified_at,qualification_step,qualification_draft,qualification_progress_at", { count: "exact" }).eq("source", "web").gte("created_at", madridMidnight(range.start)).lt("created_at", madridMidnight(range.end));
  if (email) query = query.ilike("email", `%${email.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * perPage, page * perPage - 1);
  if (error) throw new Error("No se pudieron consultar los contactos.");
  const link = (n: number) => `/admin/contacts?${new URLSearchParams({ start: range.start, end: range.end, email, perPage: String(perPage), page: String(n) })}`;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pageButton = (target: number, label: string, icon: ReactNode, className?: string) => target < 1 || target > totalPages || target === page
    ? <Button variant="outline" size="icon-sm" className={className} disabled aria-label={label}>{icon}</Button>
    : <Button variant="outline" size="icon-sm" className={className} asChild><Link href={link(target)} aria-label={label} scroll={false}>{icon}</Link></Button>;
  return <div className="admin-page admin-contacts">
    <div className="admin-page-heading"><div><h1>Contactos</h1><p className="admin-muted">Solicitudes recibidas desde la web</p></div><DateRangeFilter key={`${range.start}-${range.end}`} {...range} todayEnd={dateRange().end} pathname="/admin/contacts" query={email ? { email, perPage: String(perPage) } : { perPage: String(perPage) }} /></div>
    {range.error ? <p role="alert" className="admin-error">{range.error}</p> : null}
    <div className="contacts-toolbar">
      <form className="contacts-search" method="get" action="/admin/contacts">
        <input type="hidden" name="start" value={range.start} /><input type="hidden" name="end" value={range.end} /><input type="hidden" name="perPage" value={perPage} />
        <Label htmlFor="contact-search" className="sr-only">Buscar email</Label>
        <Search size={16} aria-hidden="true" />
        <Input id="contact-search" key={email} name="email" type="search" defaultValue={email} placeholder="Buscar por email…" maxLength={254} />
      </form>
      {email ? <Button variant="ghost" size="sm" asChild><Link href={`/admin/contacts?${new URLSearchParams({ start: range.start, end: range.end, perPage: String(perPage) })}`}>Limpiar <X aria-hidden="true" /></Link></Button> : null}
    </div>
    <div className="contacts-table">
      <Table aria-label="Solicitudes de contacto">
        <TableHeader><TableRow>
          <TableHead scope="col">Contacto</TableHead>
          <TableHead scope="col">Teléfono</TableHead>
          <TableHead scope="col" className="contacts-col-source">Origen</TableHead>
          <TableHead scope="col" className="contacts-col-form">Formulario</TableHead>
          <TableHead scope="col" className="contacts-col-consent">WhatsApp</TableHead>
          <TableHead scope="col" className="contacts-col-date">Fecha</TableHead>
          <TableHead scope="col" className="contacts-col-actions"><span className="sr-only">Acciones</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{data?.length ? data.map((lead) => {
          const status = formStatus(lead);
          const url = whatsappUrl(lead);
          return <TableRow key={lead.id}>
            <TableCell><span className="contacts-name">{lead.name || "Sin nombre"}</span><a className="contacts-sub" href={`mailto:${lead.email}`} title={lead.email}>{lead.email}</a></TableCell>
            <TableCell>{lead.phone && url ? <a className="contacts-phone" href={url} target="_blank" rel="noopener noreferrer" title={`Abrir WhatsApp con ${lead.name || lead.email}`}>{lead.phone}</a> : <span className="contacts-sub" title="Pendiente del segundo formulario">—</span>}</TableCell>
            <TableCell className="contacts-col-source"><span className="contacts-line">{lead.utm_source ?? "Sin fuente"}</span><span className="contacts-sub">{lead.utm_campaign ?? "Sin campaña"}</span></TableCell>
            <TableCell className="contacts-col-form"><Badge variant="outline" className="contacts-status" data-tone={status.tone} title={status.detail}>{status.label}</Badge></TableCell>
            <TableCell className="contacts-col-consent"><Badge variant="outline" className="contacts-status" data-tone={lead.whatsapp_consent ? "done" : "idle"}>{lead.whatsapp_consent ? "Activo" : "Pendiente"}</Badge></TableCell>
            <TableCell className="contacts-col-date"><time dateTime={lead.created_at}>{formatDate(new Date(lead.created_at))}</time></TableCell>
            <TableCell className="contacts-col-actions"><ContactDetailsDialog name={lead.name || "Sin nombre"} email={lead.email} phone={lead.phone} whatsappUrl={url} sections={detailSections(lead)} /></TableCell>
          </TableRow>;
        }) : <TableRow><TableCell colSpan={7} className="contacts-empty">{email ? "Ningún contacto coincide con ese email." : "No hay contactos en este período."}</TableCell></TableRow>}</TableBody>
      </Table>
    </div>
    <div className="contacts-footer">
      <p>{total ? `${formatNumber((page - 1) * perPage + 1)}–${formatNumber(Math.min(page * perPage, total))} de ${formatNumber(total)}` : "0 resultados"}</p>
      <div className="contacts-footer-controls">
        <PageSizeSelect value={perPage} options={PAGE_SIZES} pathname="/admin/contacts" query={{ start: range.start, end: range.end, ...(email ? { email } : {}) }} />
        <span className="contacts-page-count">Página {formatNumber(Math.min(page, totalPages))} de {formatNumber(totalPages)}</span>
        <div className="contacts-page-buttons">
          {pageButton(1, "Primera página", <ChevronsLeft aria-hidden="true" />, "contacts-page-edge")}
          {pageButton(page - 1, "Página anterior", <ChevronLeft aria-hidden="true" />)}
          {pageButton(page + 1, "Página siguiente", <ChevronRight aria-hidden="true" />)}
          {pageButton(totalPages, "Última página", <ChevronsRight aria-hidden="true" />, "contacts-page-edge")}
        </div>
      </div>
    </div>
  </div>;
}
export default function Page({ searchParams }: { searchParams: Promise<{ start?: string; end?: string; page?: string; perPage?: string; email?: string }> }) { return <Suspense fallback={<AdminLoading />}><Contacts searchParams={searchParams} /></Suspense>; }
