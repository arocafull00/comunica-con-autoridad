import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CalendarClock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminLoading } from "../../loading-state";
import { CallsColumnInfo } from "../../calls-column-info";
import { CallContactDialog, type CallContact } from "../../call-contact-dialog";

async function Calls() {
  "use cache: private";
  cacheLife({ stale: 60 });
  const { db } = await requireAdmin();
  const { data, error } = await db.from("call_bookings")
    .select("uid,email,start_time,time_zone,meeting_url,status,confirmed_at,registration_id")
    .eq("status", "booked").gte("start_time", new Date().toISOString())
    .order("start_time").order("uid").limit(100);
  if (error) throw new Error("No se pudieron consultar las llamadas.");
  const calls = data ?? [];
  const registrationIds = [...new Set(calls.map(call => call.registration_id).filter((id): id is string => !!id))];
  const contacts = new Map<string, CallContact>();
  if (registrationIds.length) {
    const { data: registrations, error: registrationsError } = await db.from("webinar_registrations")
      .select("id,lead_id").in("id", registrationIds);
    if (registrationsError) throw new Error("No se pudieron consultar los contactos de las llamadas.");
    const leadIds = [...new Set((registrations ?? []).map(registration => registration.lead_id))];
    if (leadIds.length) {
      const { data: leads, error: leadsError } = await db.from("leads")
        .select("id,name,phone,profession,situation,goal").in("id", leadIds);
      if (leadsError) throw new Error("No se pudieron consultar los contactos de las llamadas.");
      for (const registration of registrations ?? []) {
        const lead = leads?.find(lead => lead.id === registration.lead_id);
        if (lead) contacts.set(registration.id, { name: lead.name, phone: lead.phone, profession: lead.profession, situation: lead.situation, goal: lead.goal });
      }
    }
  }
  const pending = calls.filter((call) => !call.confirmed_at).length;
  return <div className="admin-page admin-calls">
    <div className="admin-page-heading"><div><h1>Llamadas</h1><p className="admin-muted">Próximas reservas de Cal.com</p></div><Button variant="outline" asChild><a href="https://app.cal.com/bookings" target="_blank" rel="noopener noreferrer">Gestionar reservas en Cal.com<ArrowUpRight size={14} aria-hidden="true" /></a></Button></div>
    <dl className="admin-stats admin-inline-stats"><div><dt>Por revisar</dt><dd className={pending ? "admin-attention" : undefined}>{pending}</dd></div><div><dt>Confirmadas</dt><dd>{calls.length - pending}</dd></div><div><dt>Reservas en esta lista</dt><dd>{calls.length}</dd></div></dl>
    <p className="admin-context-note">Se muestran hasta 100 reservas próximas. Las pendientes todavía no tienen confirmación de asistencia por WhatsApp; no se cancelan automáticamente.</p>
    {calls.length ? <div className="admin-data-table"><Table className="admin-table" aria-label="Próximas llamadas">
      <TableHeader><TableRow><TableHead scope="col"><CallsColumnInfo column="contact" /></TableHead><TableHead scope="col"><CallsColumnInfo column="date" /></TableHead><TableHead scope="col"><CallsColumnInfo column="time" /></TableHead><TableHead scope="col"><CallsColumnInfo column="confirmation" /></TableHead><TableHead scope="col"><CallsColumnInfo column="meeting" /></TableHead></TableRow></TableHeader>
      <TableBody>{calls.map(call => <TableRow key={call.uid}>
        <TableCell><CallsColumnInfo column="contact" mobile /><CallContactDialog email={call.email} contact={contacts.get(call.registration_id) ?? null} registered={!!call.registration_id} timeZone={call.time_zone} /></TableCell>
        <TableCell><CallsColumnInfo column="date" mobile /><time dateTime={call.start_time}>{new Intl.DateTimeFormat("es-ES", { timeZone: call.time_zone, dateStyle: "medium" }).format(new Date(call.start_time))}</time></TableCell>
        <TableCell><CallsColumnInfo column="time" mobile /><time dateTime={call.start_time}>{new Intl.DateTimeFormat("es-ES", { timeZone: call.time_zone, timeStyle: "short" }).format(new Date(call.start_time))}</time></TableCell>
        <TableCell><CallsColumnInfo column="confirmation" mobile /><Badge variant="outline" className={`admin-badge ${call.confirmed_at ? "admin-badge-enabled" : ""}`}>{call.confirmed_at ? "CONFIRMO recibido" : "Pendiente de revisión"}</Badge></TableCell>
        <TableCell><CallsColumnInfo column="meeting" mobile />{call.meeting_url ? <a href={call.meeting_url} target="_blank" rel="noopener noreferrer">Abrir llamada</a> : <span className="admin-muted">Enlace pendiente</span>}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div> : <div className="admin-empty"><CalendarClock size={24} aria-hidden="true" /><strong>No hay próximas llamadas registradas.</strong><p>Las reservas recibidas de Cal.com aparecerán aquí.</p></div>}
  </div>;
}

export default function Page() { return <Suspense fallback={<AdminLoading />}><Calls /></Suspense>; }
