import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { whatsappJobStatus } from "@/lib/followups/whatsapp-automations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CalendarClock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminLoading } from "../../loading-state";
import { CallsColumnInfo } from "../../calls-column-info";
import { CallContactDialog, type CallContact } from "../../call-contact-dialog";

const FLOW_STEPS = [
  { step: "booking_ok_request", label: "Mensaje OK" },
  { step: "booking_audio_1", label: "Audio 1" },
  { step: "booking_confirm_request", label: "Petición de confirmación" },
  { step: "booking_audio_2", label: "Audio 2" },
] as const;
type FlowJob = { booking_uid: string; booking_revision: number; step: string; status: string; last_error: string | null };

function attendance(call: { confirmed_at: string | null; ok_received_at: string | null; whatsapp_flow: string | null }) {
  if (call.confirmed_at) return { label: "Asistencia confirmada", className: "admin-badge-enabled" };
  if (call.ok_received_at) return { label: "OK recibido", className: "" };
  return { label: call.whatsapp_flow === "audio" ? "Pendiente de OK" : "Pendiente de confirmación por WhatsApp", className: "" };
}

async function Calls() {
  "use cache: private";
  cacheLife({ stale: 60 });
  const { db } = await requireAdmin();
  const { data, error } = await db.from("call_bookings")
    .select("uid,email,start_time,time_zone,meeting_url,status,confirmed_at,ok_received_at,whatsapp_flow,revision,registration_id")
    .eq("status", "booked").gte("start_time", new Date().toISOString())
    .order("start_time").order("uid").limit(100);
  if (error) throw new Error("No se pudieron consultar las llamadas.");
  const calls = data ?? [];
  const registrationIds = [...new Set(calls.map(call => call.registration_id).filter((id): id is string => !!id))];
  const contacts = new Map<string, CallContact>();
  const flowJobs = new Map<string, FlowJob[]>();
  const audioCalls = calls.filter(call => call.whatsapp_flow === "audio");
  if (audioCalls.length) {
    const { data: jobs, error: jobsError } = await db.from("followup_jobs")
      .select("booking_uid,booking_revision,step,status,last_error")
      .in("booking_uid", audioCalls.map(call => call.uid)).in("step", FLOW_STEPS.map(({ step }) => step))
      .overrideTypes<FlowJob[], { merge: false }>();
    if (jobsError) throw new Error("No se pudieron consultar los mensajes de las llamadas.");
    for (const job of jobs ?? []) flowJobs.set(job.booking_uid, [...flowJobs.get(job.booking_uid) ?? [], job]);
  }
  if (registrationIds.length) {
    const { data: registrations, error: registrationsError } = await db.from("webinar_registrations")
      .select("id,lead_id").in("id", registrationIds);
    if (registrationsError) throw new Error("No se pudieron consultar los contactos de las llamadas.");
    const leadIds = [...new Set((registrations ?? []).map(registration => registration.lead_id))];
    if (leadIds.length) {
      const { data: leads, error: leadsError } = await db.from("leads")
        .select("id,name,phone,profession,situation,goal,commitment,investment,application_reasons,admission_decision").in("id", leadIds);
      if (leadsError) throw new Error("No se pudieron consultar los contactos de las llamadas.");
      for (const registration of registrations ?? []) {
        const lead = leads?.find(lead => lead.id === registration.lead_id);
        if (lead) contacts.set(registration.id, { name: lead.name, phone: lead.phone, profession: lead.profession, situation: lead.situation, goal: lead.goal, commitment: lead.commitment, investment: lead.investment, application_reasons: lead.application_reasons, admission_decision: lead.admission_decision });
      }
    }
  }
  const confirmed = calls.filter(call => call.confirmed_at).length;
  const okOnly = calls.filter(call => !call.confirmed_at && call.ok_received_at).length;
  const pending = calls.length - confirmed - okOnly;
  return <div className="admin-page admin-calls">
    <div className="admin-page-heading"><div><h1>Llamadas</h1><p className="admin-muted">Próximas reservas de Cal.com</p></div><Button variant="outline" asChild><a href="https://app.cal.com/bookings" target="_blank" rel="noopener noreferrer">Gestionar reservas en Cal.com<ArrowUpRight size={14} aria-hidden="true" /></a></Button></div>
    <dl className="admin-stats admin-inline-stats"><div><dt>Por revisar</dt><dd className={pending ? "admin-attention" : undefined}>{pending}</dd></div><div><dt>OK recibido</dt><dd>{okOnly}</dd></div><div><dt>Asistencia confirmada</dt><dd>{confirmed}</dd></div><div><dt>Reservas en esta lista</dt><dd>{calls.length}</dd></div></dl>
    <p className="admin-context-note">Se muestran hasta 100 reservas próximas. «OK recibido» indica que ha recibido la información de la reserva; solo «Asistencia confirmada» confirma que asistirá. Las reservas sin confirmar no se cancelan automáticamente.</p>
    {calls.length ? <div className="admin-data-table"><Table className="admin-table" aria-label="Próximas llamadas">
      <TableHeader><TableRow><TableHead scope="col"><CallsColumnInfo column="contact" /></TableHead><TableHead scope="col"><CallsColumnInfo column="date" /></TableHead><TableHead scope="col"><CallsColumnInfo column="time" /></TableHead><TableHead scope="col"><CallsColumnInfo column="confirmation" /></TableHead><TableHead scope="col"><CallsColumnInfo column="audios" /></TableHead><TableHead scope="col"><CallsColumnInfo column="meeting" /></TableHead></TableRow></TableHeader>
      <TableBody>{calls.map(call => {
        const state = attendance(call);
        const jobs = (flowJobs.get(call.uid) ?? []).filter(job => job.booking_revision === call.revision);
        return <TableRow key={call.uid}>
          <TableCell><CallsColumnInfo column="contact" mobile /><CallContactDialog email={call.email} contact={contacts.get(call.registration_id) ?? null} registered={!!call.registration_id} timeZone={call.time_zone} /></TableCell>
          <TableCell><CallsColumnInfo column="date" mobile /><time dateTime={call.start_time}>{new Intl.DateTimeFormat("es-ES", { timeZone: call.time_zone, dateStyle: "medium" }).format(new Date(call.start_time))}</time></TableCell>
          <TableCell><CallsColumnInfo column="time" mobile /><time dateTime={call.start_time}>{new Intl.DateTimeFormat("es-ES", { timeZone: call.time_zone, timeStyle: "short" }).format(new Date(call.start_time))}</time></TableCell>
          <TableCell><CallsColumnInfo column="confirmation" mobile /><Badge variant="outline" className={`admin-badge ${state.className}`}>{state.label}</Badge></TableCell>
          <TableCell><CallsColumnInfo column="audios" mobile />{call.whatsapp_flow === "audio" ? <ul className="admin-call-flow">{FLOW_STEPS.map(({ step, label }) => {
            const job = jobs.find(candidate => candidate.step === step);
            return <li key={step}><span className="admin-muted">{label}:</span> {job ? whatsappJobStatus(job.status, job.last_error) : step === "booking_audio_1" ? "Esperando OK" : step === "booking_confirm_request" ? "Tras el primer audio" : "Sin programar"}</li>;
          })}</ul> : <span className="admin-muted">Reserva sin flujo de audios</span>}</TableCell>
          <TableCell><CallsColumnInfo column="meeting" mobile />{call.meeting_url ? <a href={call.meeting_url} target="_blank" rel="noopener noreferrer">Abrir llamada</a> : <span className="admin-muted">Enlace pendiente</span>}</TableCell>
        </TableRow>;
      })}</TableBody>
    </Table></div> : <div className="admin-empty"><CalendarClock size={24} aria-hidden="true" /><strong>No hay próximas llamadas registradas.</strong><p>Las reservas recibidas de Cal.com aparecerán aquí.</p></div>}
  </div>;
}

export default function Page() { return <Suspense fallback={<AdminLoading />}><Calls /></Suspense>; }
