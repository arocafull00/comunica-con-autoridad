import { Suspense } from "react";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { dateRange } from "@/lib/admin/validation";
import { madridMidnight } from "@/lib/admin/traffic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AdminLoading } from "../../loading-state";
import { DateRangeFilter } from "../../date-range-filter";
import { QUALIFICATION_STEP_LABELS } from "@/lib/funnel";
import { PageSizeSelect } from "../../page-size-select";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis } from "@/components/ui/pagination";

const DRAFT_LABELS: Record<string, string> = { profession: "Profesión", situation: "Situación", goal: "Quiere mejorar", commitment: "Compromiso", investment: "Inversión", applicationReasons: "Razones para reservar" };

function FormProgress({ lead }: { lead: { qualified_at: string | null; qualification_step: number | null; qualification_draft: Record<string, string> | null } }) {
  if (lead.qualified_at) return <p className="admin-form-progress">Formulario completado</p>;
  if (!lead.qualification_step) return <p className="admin-form-progress">No ha empezado las preguntas</p>;
  const draft = Object.entries(lead.qualification_draft ?? {}).filter(([field]) => DRAFT_LABELS[field]);
  return <>
    <p className="admin-form-progress admin-form-progress-open">Se quedó en la pregunta {lead.qualification_step} de {QUALIFICATION_STEP_LABELS.length} · {QUALIFICATION_STEP_LABELS[lead.qualification_step - 1]}</p>
    {draft.length ? <details><summary>Respuestas sin enviar</summary>{draft.map(([field, value]) => <p key={field}><strong>{DRAFT_LABELS[field]}:</strong> {value}</p>)}</details> : null}
  </>;
}

const PAGE_SIZES = [10, 25, 50] as const;

function pageItems(page: number, total: number) {
  const pages = [...new Set([1, page - 1, page, page + 1, total])].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  return pages.flatMap((n, i): (number | "gap")[] => !i ? [n] : n - pages[i - 1] === 2 ? [n - 1, n] : n - pages[i - 1] > 2 ? ["gap", n] : [n]);
}
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
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / perPage));
  const formatNumber = new Intl.NumberFormat("es-ES").format;
  return <div className="admin-page admin-contacts">
    <div className="admin-page-heading"><div><h1>Contactos</h1><p className="admin-muted">Solicitudes recibidas desde la web</p></div><DateRangeFilter key={`${range.start}-${range.end}`} {...range} todayEnd={dateRange().end} pathname="/admin/contacts" query={email ? { email, perPage: String(perPage) } : { perPage: String(perPage) }} /></div>
    {range.error ? <p role="alert" className="admin-error">{range.error}</p> : null}
    <div className="admin-table-toolbar">
      <p className="admin-result-count"><strong>{formatNumber(count ?? 0)}</strong> {count === 1 ? "solicitud" : "solicitudes"} {email ? (count === 1 ? "que coincide" : "que coinciden") : "en este período"}</p>
      <form className="admin-search" method="get" action="/admin/contacts">
        <input type="hidden" name="start" value={range.start} /><input type="hidden" name="end" value={range.end} /><input type="hidden" name="perPage" value={perPage} />
        <Label htmlFor="contact-search" className="sr-only">Buscar email</Label><div className="admin-search-field"><Search size={16} aria-hidden="true" /><Input id="contact-search" key={email} name="email" type="search" defaultValue={email} placeholder="Buscar por email" maxLength={254} /></div>
        <Button type="submit" variant="outline">Buscar</Button>{email ? <Link className="admin-clear-search" href={`/admin/contacts?${new URLSearchParams({ start: range.start, end: range.end, perPage: String(perPage) })}`}>Limpiar búsqueda</Link> : null}
      </form>
    </div>
    {data?.length ? <div className="admin-data-table">
      <Table className="admin-table" aria-label="Solicitudes de contacto">
        <TableHeader><TableRow>
          <TableHead scope="col">Nombre</TableHead>
          <TableHead scope="col">Solicitud</TableHead>
          <TableHead scope="col">Teléfono</TableHead>
          <TableHead scope="col">Correo</TableHead>
          <TableHead scope="col">Confirmación</TableHead>
        </TableRow></TableHeader>
        <TableBody>{data.map((lead) => <TableRow key={lead.id}>
          <TableCell data-label="Nombre"><strong>{lead.name || "Sin nombre"}</strong></TableCell>
          <TableCell data-label="Solicitud">
            <time dateTime={lead.created_at}>{new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" }).format(new Date(lead.created_at))}</time>
            <p>{lead.utm_source ?? "Sin fuente"} · {lead.utm_campaign ?? "Sin campaña"}</p>
            <FormProgress lead={lead} />
            {lead.profession ? <details><summary>Respuestas de la masterclass</summary><p><strong>Profesión:</strong> {lead.profession}</p>{lead.situation ? <p><strong>Situación:</strong> {lead.situation}</p> : null}<p><strong>Quiere mejorar:</strong> {lead.goal}</p>{lead.commitment ? <p><strong>Compromiso:</strong> {lead.commitment}</p> : null}{lead.investment ? <p><strong>Inversión:</strong> {lead.investment}</p> : null}{lead.application_reasons ? <p><strong>Razones para reservar:</strong> {lead.application_reasons}</p> : null}{lead.admission_decision ? <p><strong>Decisión:</strong> {lead.admission_decision}</p> : null}</details> : null}
          </TableCell>
          <TableCell data-label="Teléfono">
            {lead.phone ? <><a href={`https://wa.me/${lead.phone.replace(/\D/g, "")}?text=${encodeURIComponent(lead.name ? `Hola, ${lead.name}. ¿Cómo estás?` : "Hola. ¿Cómo estás?")}`} target="_blank" rel="noopener noreferrer" title={`Abrir WhatsApp con ${lead.name || lead.email}`}>{lead.phone}</a><p>WhatsApp</p></>
              : <span className="admin-muted">Pendiente del segundo formulario</span>}
          </TableCell>
          <TableCell data-label="Correo"><a href={`mailto:${lead.email}`}>{lead.email}</a></TableCell>
          <TableCell data-label="Confirmación"><Badge variant="outline" className={`admin-badge ${lead.whatsapp_consent ? "admin-badge-enabled" : ""}`}>{lead.whatsapp_consent ? "WhatsApp activo" : "WhatsApp pendiente o retirado"}</Badge></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div> : <div className="admin-empty"><UsersRound size={24} aria-hidden="true" /><strong>No hay contactos que coincidan con la búsqueda.</strong><p>Prueba con otro email o amplía el período seleccionado.</p></div>}
    {count ? <div className="admin-pagination">
      <div className="admin-pagination-summary"><span>{formatNumber((page - 1) * perPage + 1)}–{formatNumber(Math.min(page * perPage, count))} de {formatNumber(count)}</span><PageSizeSelect value={perPage} options={PAGE_SIZES} pathname="/admin/contacts" query={{ start: range.start, end: range.end, ...(email ? { email } : {}) }} /></div>
      {totalPages > 1 ? <Pagination className="admin-pagination-nav"><PaginationContent>
        <PaginationItem><PaginationPrevious href={link(page - 1)} disabled={page === 1} /></PaginationItem>
        {pageItems(page, totalPages).map((item, i) => <PaginationItem key={item === "gap" ? `gap-${i}` : item}>{item === "gap" ? <PaginationEllipsis /> : <PaginationLink href={link(item)} isActive={item === page} aria-label={`Página ${item}`}>{item}</PaginationLink>}</PaginationItem>)}
        <PaginationItem><PaginationNext href={link(page + 1)} disabled={page === totalPages} /></PaginationItem>
      </PaginationContent></Pagination> : null}
    </div> : null}
  </div>;
}
export default function Page({ searchParams }: { searchParams: Promise<{ start?: string; end?: string; page?: string; perPage?: string; email?: string }> }) { return <Suspense fallback={<AdminLoading />}><Contacts searchParams={searchParams} /></Suspense>; }
