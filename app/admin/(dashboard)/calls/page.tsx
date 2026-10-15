import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { whatsappJobStatus } from "@/lib/followups/whatsapp-automations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminLoading } from "../../loading-state";
import { CallsColumnInfo } from "../../calls-column-info";
import { ContactDetailsDialog, type ContactDetailsSection } from "../../contact-details-dialog";
import { DataTablePagination, pageParams } from "../../data-table-pagination";

const FLOW_STEPS = [
  { step: "booking_ok_request", label: "Mensaje OK" },
  { step: "booking_audio_1", label: "Audio 1" },
  { step: "booking_confirm_request", label: "Petición de confirmación" },
  { step: "booking_audio_2", label: "Audio 2" },
] as const;
type FlowJob = { booking_uid: string; booking_revision: number; step: string; status: string; last_error: string | null };
type Contact = { name: string | null; phone: string | null; profession: string | null; situation: string | null; goal: string | null; commitment: string | null; investment: string | null; application_reasons: string | null; admission_decision: string | null };
type Call = { uid: string; email: string; start_time: string; time_zone: string; meeting_url: string | null; confirmed_at: string | null; ok_received_at: string | null; whatsapp_flow: string | null; registration_id: string | null };

function attendance(call: Call) {
  if (call.confirmed_at) return { tone: "done", label: "Confirmada", detail: "Asistencia confirmada" };
  if (call.ok_received_at) return { tone: "open", label: "OK recibido", detail: "OK recibido" };
  return call.whatsapp_flow === "audio" ? { tone: "idle", label: "Pendiente de OK", detail: "Pendiente de OK" } : { tone: "idle", label: "Pendiente", detail: "Pendiente de confirmación por WhatsApp" };
}

function flowSummary(jobs: FlowJob[]) {
  const sent = jobs.filter(job => job.status === "sent").length;
  const tone = jobs.some(job => job.status === "failed") ? "failed" : sent === FLOW_STEPS.length ? "done" : sent ? "open" : "idle";
  return { tone, label: `${sent}/${FLOW_STEPS.length} enviados` };
}

function flowStepStatus(step: string, job: FlowJob | undefined) {
  if (job) return whatsappJobStatus(job.status, job.last_error);
  return step === "booking_audio_1" ? "Esperando OK" : step === "booking_confirm_request" ? "Tras el primer audio" : "Sin programar";
}

function detailSections(call: Call, contact: Contact | null, jobs: FlowJob[]): ContactDetailsSection[] {
  const present = (fields: [string, string | null][]) => fields.filter((field): field is [string, string] => Boolean(field[1]));
  const start = new Date(call.start_time);
  const answers = contact ? present([["Profesión", contact.profession], ["Situación", contact.situation], ["Quiere mejorar", contact.goal], ["Compromiso", contact.commitment], ["Inversión", contact.investment], ["Razones para reservar", contact.application_reasons], ["Decisión", contact.admission_decision]]) : [];
  return [
    { title: "Llamada", fields: [
      ["Fecha", new Intl.DateTimeFormat("es-ES", { timeZone: call.time_zone, dateStyle: "full" }).format(start)],
      ["Hora", new Intl.DateTimeFormat("es-ES", { timeZone: call.time_zone, timeStyle: "short" }).format(start)],
      ["Zona horaria", call.time_zone],
      ["Confirmación", attendance(call).detail],
      ["Enlace", call.meeting_url ?? "Enlace pendiente"],
    ] },
    { title: "Formulario de la masterclass", fields: [["Formulario", call.registration_id ? "Formulario asociado a este email." : "Sin formulario asociado a este email."], ...answers] },
    ...(call.whatsapp_flow === "audio" ? [{ title: "Mensajes y audios", fields: FLOW_STEPS.map(({ step, label }): [string, string] => [label, flowStepStatus(step, jobs.find(job => job.step === step))]) }] : []),
  ];
}

async function Calls({ searchParams }: { searchParams: Promise<{ page?: string; perPage?: string }> }) {
  "use cache: private";
  cacheLife({ stale: 60 });
  const { page, perPage, from, to } = pageParams(await searchParams);
  const { db } = await requireAdmin();
  const now = new Date().toISOString();
  const upcoming = () => db.from("call_bookings").select("uid", { count: "exact", head: true }).eq("status", "booked").gte("start_time", now);
  const [list, confirmedCount, okCount] = await Promise.all([
    db.from("call_bookings")
      .select("uid,email,start_time,time_zone,meeting_url,status,confirmed_at,ok_received_at,whatsapp_flow,revision,registration_id", { count: "exact" })
      .eq("status", "booked").gte("start_time", now)
      .order("start_time").order("uid").range(from, to),
    upcoming().not("confirmed_at", "is", null),
    upcoming().is("confirmed_at", null).not("ok_received_at", "is", null),
  ]);
  if (list.error || confirmedCount.error || okCount.error) throw new Error("No se pudieron consultar las llamadas.");
  const calls = list.data ?? [];
  const total = list.count ?? 0;
  const registrationIds = [...new Set(calls.map(call => call.registration_id).filter((id): id is string => !!id))];
  const contacts = new Map<string, Contact>();
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
        if (lead) contacts.set(registration.id, lead);
      }
    }
  }
  const confirmed = confirmedCount.count ?? 0;
  const okOnly = okCount.count ?? 0;
  const pending = total - confirmed - okOnly;
  return <div className="admin-page admin-calls">
    <div className="admin-page-heading"><div><h1>Llamadas</h1><p className="admin-muted">Próximas reservas de Cal.com</p></div><Button variant="outline" asChild><a href="https://app.cal.com/bookings" target="_blank" rel="noopener noreferrer">Gestionar reservas en Cal.com<ArrowUpRight size={14} aria-hidden="true" /></a></Button></div>
    <dl className="admin-stats admin-inline-stats"><div><dt>Por revisar</dt><dd className={pending ? "admin-attention" : undefined}>{pending}</dd></div><div><dt>OK recibido</dt><dd>{okOnly}</dd></div><div><dt>Asistencia confirmada</dt><dd>{confirmed}</dd></div><div><dt>Próximas reservas</dt><dd>{total}</dd></div></dl>
    <p className="admin-context-note">«OK recibido» indica que ha recibido la información de la reserva; solo «Confirmada» confirma que asistirá. Las reservas sin confirmar no se cancelan automáticamente.</p>
    <div className="data-table">
      <Table aria-label="Próximas llamadas">
        <TableHeader><TableRow>
          <TableHead scope="col"><CallsColumnInfo column="contact" /></TableHead>
          <TableHead scope="col" className="col-hide-sm"><CallsColumnInfo column="date" /></TableHead>
          <TableHead scope="col"><CallsColumnInfo column="confirmation" /></TableHead>
          <TableHead scope="col" className="col-hide-md"><CallsColumnInfo column="audios" /></TableHead>
          <TableHead scope="col" className="col-hide-sm"><CallsColumnInfo column="meeting" /></TableHead>
          <TableHead scope="col" className="data-table-actions"><span className="sr-only">Acciones</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{calls.length ? calls.map(call => {
          const contact = (call.registration_id && contacts.get(call.registration_id)) || null;
          const jobs = (flowJobs.get(call.uid) ?? []).filter(job => job.booking_revision === call.revision);
          const state = attendance(call);
          const flow = flowSummary(jobs);
          const start = new Date(call.start_time);
          const name = contact?.name || call.email;
          return <TableRow key={call.uid}>
            <TableCell><span className="data-table-name">{contact?.name || "Sin formulario"}</span><a className="data-table-sub hide-sm" href={`mailto:${call.email}`} title={call.email}>{call.email}</a><span className="data-table-sub show-sm">{new Intl.DateTimeFormat("es-ES", { timeZone: call.time_zone, dateStyle: "medium", timeStyle: "short" }).format(start)}</span></TableCell>
            <TableCell className="col-hide-sm"><time className="data-table-line" dateTime={call.start_time}>{new Intl.DateTimeFormat("es-ES", { timeZone: call.time_zone, dateStyle: "medium" }).format(start)}</time><span className="data-table-sub">{new Intl.DateTimeFormat("es-ES", { timeZone: call.time_zone, timeStyle: "short" }).format(start)}</span></TableCell>
            <TableCell><Badge variant="outline" className="data-table-status" data-tone={state.tone} title={state.detail}>{state.label}</Badge></TableCell>
            <TableCell className="col-hide-md">{call.whatsapp_flow === "audio" ? <Badge variant="outline" className="data-table-status" data-tone={flow.tone}>{flow.label}</Badge> : <span className="data-table-sub">Sin audios</span>}</TableCell>
            <TableCell className="col-hide-sm">{call.meeting_url ? <Button variant="ghost" size="sm" asChild><a href={call.meeting_url} target="_blank" rel="noopener noreferrer">Abrir llamada<ArrowUpRight aria-hidden="true" /></a></Button> : <span className="data-table-sub">Enlace pendiente</span>}</TableCell>
            <TableCell className="data-table-actions"><ContactDetailsDialog name={name} email={call.email} phone={contact?.phone ?? null} whatsappUrl={contact?.phone ? `https://wa.me/${contact.phone.replace(/\D/g, "")}` : null} sections={detailSections(call, contact, jobs)} note={call.registration_id ? undefined : "Puede haber reservado directamente en Cal.com o haber usado otro email en el formulario. Hasta que se vincule una inscripción, no se envían los mensajes automáticos de seguimiento de esta llamada."} /></TableCell>
          </TableRow>;
        }) : <TableRow><TableCell colSpan={6} className="data-table-empty">No hay próximas llamadas. Las reservas de Cal.com aparecerán aquí.</TableCell></TableRow>}</TableBody>
      </Table>
    </div>
    <DataTablePagination page={page} perPage={perPage} total={total} pathname="/admin/calls" />
  </div>;
}

export default function Page({ searchParams }: { searchParams: Promise<{ page?: string; perPage?: string }> }) { return <Suspense fallback={<AdminLoading />}><Calls searchParams={searchParams} /></Suspense>; }
