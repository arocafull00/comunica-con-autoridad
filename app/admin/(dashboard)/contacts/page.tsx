import { Suspense } from "react";
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
async function Contacts({ searchParams }: { searchParams: Promise<{ start?: string; end?: string; page?: string; email?: string }> }) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const range = dateRange(params.start, params.end);
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.page) || 1)));
  const email = (params.email ?? "").trim().slice(0, 254);
  let query = db.from("leads").select("id,name,email,phone,created_at,whatsapp_consent,utm_source,utm_campaign,profession,situation,goal", { count: "exact" }).eq("source", "web").gte("created_at", madridMidnight(range.start)).lt("created_at", madridMidnight(range.end));
  if (email) query = query.ilike("email", `%${email.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * 25, page * 25 - 1);
  if (error) throw new Error("No se pudieron consultar los contactos.");
  const link = (n: number) => `/admin/contacts?${new URLSearchParams({ start: range.start, end: range.end, email, page: String(n) })}`;
  return <div className="admin-page admin-contacts">
    <div className="admin-page-heading"><div><h1>Contactos</h1><p className="admin-muted">Solicitudes recibidas desde la web</p></div><DateRangeFilter key={`${range.start}-${range.end}`} {...range} todayEnd={dateRange().end} pathname="/admin/contacts" query={email ? { email } : {}} /></div>
    {range.error ? <p role="alert" className="admin-error">{range.error}</p> : null}
    <div className="admin-table-toolbar">
      <p className="admin-result-count"><strong>{new Intl.NumberFormat("es-ES").format(count ?? 0)}</strong> {count === 1 ? "solicitud" : "solicitudes"} {email ? (count === 1 ? "que coincide" : "que coinciden") : "en este período"}</p>
      <form className="admin-search" method="get" action="/admin/contacts">
        <input type="hidden" name="start" value={range.start} /><input type="hidden" name="end" value={range.end} />
        <Label htmlFor="contact-search" className="sr-only">Buscar email</Label><div className="admin-search-field"><Search size={16} aria-hidden="true" /><Input id="contact-search" key={email} name="email" type="search" defaultValue={email} placeholder="Buscar por email" maxLength={254} /></div>
        <Button type="submit" variant="outline">Buscar</Button>{email ? <Link className="admin-clear-search" href={`/admin/contacts?${new URLSearchParams({ start: range.start, end: range.end })}`}>Limpiar búsqueda</Link> : null}
      </form>
    </div>
    {data?.length ? <div className="admin-data-table"><Table className="admin-table" aria-label="Solicitudes de contacto"><TableHeader><TableRow><TableHead scope="col">Contacto</TableHead><TableHead scope="col">Solicitud</TableHead><TableHead scope="col">WhatsApp</TableHead></TableRow></TableHeader><TableBody>{data.map((lead) => <TableRow key={lead.id}><TableCell><strong>{lead.name}</strong><a href={`mailto:${lead.email}`}>{lead.email}</a><a href={`tel:${lead.phone}`}>{lead.phone}</a></TableCell><TableCell data-label="Solicitud"><time dateTime={lead.created_at}>{new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" }).format(new Date(lead.created_at))}</time><p>{lead.utm_source ?? "Sin fuente"} · {lead.utm_campaign ?? "Sin campaña"}</p>{lead.profession ? <details><summary>Respuestas de la masterclass</summary><p><strong>Profesión:</strong> {lead.profession}</p><p><strong>Situación:</strong> {lead.situation}</p><p><strong>Quiere mejorar:</strong> {lead.goal}</p></details> : null}</TableCell><TableCell data-label="WhatsApp"><Badge variant="outline" className={`admin-badge ${lead.whatsapp_consent ? "admin-badge-enabled" : ""}`}>{lead.whatsapp_consent ? "Aceptó la confirmación" : "Sin consentimiento"}</Badge></TableCell></TableRow>)}</TableBody></Table></div> : <div className="admin-empty"><UsersRound size={24} aria-hidden="true" /><strong>No hay contactos que coincidan con la búsqueda.</strong><p>Prueba con otro email o amplía el período seleccionado.</p></div>}
    {count ? <div className="admin-pagination"><span>{Math.min((page - 1) * 25 + 1, count)}–{Math.min(page * 25, count)} de {count} · Página {page}</span><div>{page > 1 ? <Button variant="outline" asChild><Link href={link(page - 1)}>Anterior</Link></Button> : null}{page * 25 < count ? <Button variant="outline" asChild><Link href={link(page + 1)}>Siguiente</Link></Button> : null}</div></div> : null}
  </div>;
}
export default function Page({ searchParams }: { searchParams: Promise<{ start?: string; end?: string; page?: string; email?: string }> }) { return <Suspense fallback={<AdminLoading label="Cargando contactos…" />}><Contacts searchParams={searchParams} /></Suspense>; }
