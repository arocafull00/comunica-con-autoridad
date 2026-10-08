import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CalendarClock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminLoading } from "../../loading-state";

async function Calls() {
  const { db } = await requireAdmin();
  const { data, error } = await db.from("call_bookings")
    .select("uid,email,start_time,time_zone,meeting_url,status,confirmed_at,registration_id")
    .eq("status", "booked").gte("start_time", new Date().toISOString())
    .order("start_time").order("uid").limit(100);
  if (error) throw new Error("No se pudieron consultar las llamadas.");
  const calls = data ?? [];
  const pending = calls.filter((call) => !call.confirmed_at).length;
  return <div className="admin-page admin-calls">
    <div className="admin-page-heading"><div><h1>Llamadas</h1><p className="admin-muted">Próximas reservas de Cal.com</p></div><Button variant="outline" asChild><a href="https://app.cal.com/bookings" target="_blank" rel="noopener noreferrer">Gestionar reservas en Cal.com<ArrowUpRight size={14} aria-hidden="true" /></a></Button></div>
    <dl className="admin-stats admin-inline-stats"><div><dt>Por revisar</dt><dd className={pending ? "admin-attention" : undefined}>{pending}</dd></div><div><dt>Confirmadas</dt><dd>{calls.length - pending}</dd></div><div><dt>Reservas en esta lista</dt><dd>{calls.length}</dd></div></dl>
    <p className="admin-context-note">Se muestran hasta 100 reservas próximas. Revisa las pendientes antes de decidir si mantienes la plaza.</p>
    {calls.length ? <div className="admin-data-table"><Table className="admin-table" aria-label="Próximas llamadas">
      <TableHeader><TableRow><TableHead scope="col">Contacto</TableHead><TableHead scope="col">Sesión</TableHead><TableHead scope="col">Confirmación</TableHead></TableRow></TableHeader>
      <TableBody>{calls.map(call => <TableRow key={call.uid}>
        <TableCell><a href={`mailto:${call.email}`}>{call.email}</a>{!call.registration_id ? <p className="admin-muted">Sin inscripción asociada: revisar el email de la reserva.</p> : null}</TableCell>
        <TableCell data-label="Sesión"><time dateTime={call.start_time}>{new Intl.DateTimeFormat("es-ES", { timeZone: call.time_zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(call.start_time))}</time><p className="admin-muted">{call.time_zone}</p>{call.meeting_url ? <a href={call.meeting_url} target="_blank" rel="noopener noreferrer">Abrir enlace de la llamada</a> : <p className="admin-muted">Enlace pendiente</p>}</TableCell>
        <TableCell data-label="Confirmación"><Badge variant="outline" className={`admin-badge ${call.confirmed_at ? "admin-badge-enabled" : ""}`}>{call.confirmed_at ? "CONFIRMO recibido" : "Pendiente de revisión"}</Badge></TableCell>
      </TableRow>)}</TableBody>
    </Table></div> : <div className="admin-empty"><CalendarClock size={24} aria-hidden="true" /><strong>No hay próximas llamadas registradas.</strong><p>Las reservas recibidas de Cal.com aparecerán aquí.</p></div>}
  </div>;
}

export default function Page() { return <Suspense fallback={<AdminLoading label="Cargando llamadas…" />}><Calls /></Suspense>; }
