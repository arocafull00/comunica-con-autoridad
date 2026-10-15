import { Suspense } from "react";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { dateRange } from "@/lib/admin/validation";
import { madridMidnight } from "@/lib/admin/traffic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AdminLoading } from "../../loading-state";
import { DateRangeFilter } from "../../date-range-filter";
import { QUALIFICATION_STEP_LABELS } from "@/lib/funnel";
import { DataTablePagination, pageParams } from "../../data-table-pagination";
import { ContactDetailsDialog, type ContactDetailsSection } from "../../contact-details-dialog";

const DRAFT_LABELS: Record<string, string> = { profession: "Profesión", situation: "Situación", goal: "Quiere mejorar", commitment: "Compromiso", investment: "Inversión", applicationReasons: "Razones para reservar" };
const formatDate = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" }).format;

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
  const { page, perPage, from, to } = pageParams(params);
  const email = (params.email ?? "").trim().slice(0, 254);
  let query = db.from("leads").select("id,name,email,phone,created_at,whatsapp_consent,utm_source,utm_campaign,profession,situation,goal,commitment,investment,application_reasons,admission_decision,qualified_at,qualification_step,qualification_draft,qualification_progress_at", { count: "exact" }).eq("source", "web").gte("created_at", madridMidnight(range.start)).lt("created_at", madridMidnight(range.end));
  if (email) query = query.ilike("email", `%${email.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  if (error) throw new Error("No se pudieron consultar los contactos.");
  return <div className="admin-page admin-contacts">
    <div className="admin-page-heading"><div><h1>Contactos</h1><p className="admin-muted">Solicitudes recibidas desde la web</p></div><DateRangeFilter key={`${range.start}-${range.end}`} {...range} todayEnd={dateRange().end} pathname="/admin/contacts" query={email ? { email, perPage: String(perPage) } : { perPage: String(perPage) }} /></div>
    {range.error ? <p role="alert" className="admin-error">{range.error}</p> : null}
    <div className="data-table-toolbar">
      <form className="data-table-search" method="get" action="/admin/contacts">
        <input type="hidden" name="start" value={range.start} /><input type="hidden" name="end" value={range.end} /><input type="hidden" name="perPage" value={perPage} />
        <Label htmlFor="contact-search" className="sr-only">Buscar email</Label>
        <Search size={16} aria-hidden="true" />
        <Input id="contact-search" key={email} name="email" type="search" defaultValue={email} placeholder="Buscar por email…" maxLength={254} />
      </form>
      {email ? <Button variant="ghost" size="sm" asChild><Link href={`/admin/contacts?${new URLSearchParams({ start: range.start, end: range.end, perPage: String(perPage) })}`}>Limpiar <X aria-hidden="true" /></Link></Button> : null}
    </div>
    <div className="data-table">
      <Table aria-label="Solicitudes de contacto">
        <TableHeader><TableRow>
          <TableHead scope="col">Contacto</TableHead>
          <TableHead scope="col">Teléfono</TableHead>
          <TableHead scope="col" className="col-hide-lg">Origen</TableHead>
          <TableHead scope="col" className="col-hide-sm">Formulario</TableHead>
          <TableHead scope="col" className="col-hide-md">WhatsApp</TableHead>
          <TableHead scope="col" className="data-table-date">Fecha</TableHead>
          <TableHead scope="col" className="data-table-actions"><span className="sr-only">Acciones</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{data?.length ? data.map((lead) => {
          const status = formStatus(lead);
          const url = whatsappUrl(lead);
          return <TableRow key={lead.id}>
            <TableCell><span className="data-table-name">{lead.name || "Sin nombre"}</span><a className="data-table-sub" href={`mailto:${lead.email}`} title={lead.email}>{lead.email}</a></TableCell>
            <TableCell>{lead.phone && url ? <a className="data-table-phone" href={url} target="_blank" rel="noopener noreferrer" title={`Abrir WhatsApp con ${lead.name || lead.email}`}>{lead.phone}</a> : <span className="data-table-sub" title="Pendiente del segundo formulario">—</span>}</TableCell>
            <TableCell className="col-hide-lg"><span className="data-table-line">{lead.utm_source ?? "Sin fuente"}</span><span className="data-table-sub">{lead.utm_campaign ?? "Sin campaña"}</span></TableCell>
            <TableCell className="col-hide-sm"><Badge variant="outline" className="data-table-status" data-tone={status.tone} title={status.detail}>{status.label}</Badge></TableCell>
            <TableCell className="col-hide-md"><Badge variant="outline" className="data-table-status" data-tone={lead.whatsapp_consent ? "done" : "idle"}>{lead.whatsapp_consent ? "Activo" : "Pendiente"}</Badge></TableCell>
            <TableCell className="data-table-date"><time dateTime={lead.created_at}>{formatDate(new Date(lead.created_at))}</time></TableCell>
            <TableCell className="data-table-actions"><ContactDetailsDialog name={lead.name || "Sin nombre"} email={lead.email} phone={lead.phone} whatsappUrl={url} sections={detailSections(lead)} /></TableCell>
          </TableRow>;
        }) : <TableRow><TableCell colSpan={7} className="data-table-empty">{email ? "Ningún contacto coincide con ese email." : "No hay contactos en este período."}</TableCell></TableRow>}</TableBody>
      </Table>
    </div>
    <DataTablePagination page={page} perPage={perPage} total={count ?? 0} pathname="/admin/contacts" query={{ start: range.start, end: range.end, ...(email ? { email } : {}) }} />
  </div>;
}
export default function Page({ searchParams }: { searchParams: Promise<{ start?: string; end?: string; page?: string; perPage?: string; email?: string }> }) { return <Suspense fallback={<AdminLoading />}><Contacts searchParams={searchParams} /></Suspense>; }
