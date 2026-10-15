import { randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { fixedWhatsappTemplates } from "../../lib/followups/whatsapp-automations";
import { ADMISSION_DECISIONS, BOOKING_GOALS, COMMITMENTS, GOALS, INVESTMENTS, SITUATIONS } from "../../lib/leads/masterclass";

const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname)) throw new Error("Local database only");
const pool = new pg.Pool({ connectionString: target });
let db: pg.PoolClient;
beforeEach(async () => { db = await pool.connect(); await db.query("begin"); });
afterEach(async () => { await db.query("rollback"); db.release(); });
afterAll(async () => { await pool.end(); });

const phoneNumber = () => `+3461${randomInt(1_000_000, 9_999_999)}`;
const ipHash = () => randomUUID().replaceAll("-", "").repeat(2);
type Contact = { key: string; email: string; phone: string };
async function contact({ email = `${randomUUID()}@example.com`, phone = phoneNumber(), mail = false, whatsapp = true, name = "Lucía", key = randomUUID() as string }: { email?: string; phone?: string; mail?: boolean; whatsapp?: boolean; name?: string; key?: string } = {}) {
  const result = (await db.query("select public.submit_masterclass_contact($1,$2,$3,$4,$5,$6,'2026-10-12-v1','2026-10-14-v1',$7) as result",
    [key, name, phone, email, mail, whatsapp, ipHash()])).rows[0].result;
  return { key, email, phone, result } as Contact & { result: { outcome: string; lead: Record<string, unknown> } };
}
async function jobs(registration: string) {
  return (await db.query("select step,status,last_error from public.followup_jobs where registration_id=$1 order by step", [registration])).rows;
}
async function registrationOf(email: string) {
  return (await db.query("select id,lead_id from public.webinar_registrations where email=$1", [email])).rows[0] as { id: string; lead_id: string };
}
async function approveTemplates() {
  await db.query("update public.whatsapp_settings set enabled=true");
  const steps = (await db.query("select key,body,parameter,parameters from public.followup_steps where channel='whatsapp'")).rows;
  await db.query("select public.sync_whatsapp_templates($1)", [JSON.stringify(steps.filter(s => s.key in fixedWhatsappTemplates).map(s => {
    const names: string[] = s.parameters ?? (s.parameter ? [s.parameter] : []);
    const body = names.reduce((text, name, index) => text.replaceAll(`{{${name}}}`, `{{${index + 1}}}`), s.body as string);
    const button = s.key === "booking_ok_request" ? "OK" : s.key === "booking_confirm_request" ? "CONFIRMAR" : null;
    return { ...fixedWhatsappTemplates[s.key as keyof typeof fixedWhatsappTemplates], body, meta_status: "APPROVED", approved: names.length <= 1,
      components: [{ type: "BODY", text: body }, ...(button ? [{ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: button }] }] : [])] };
  }))]);
}
async function activate() { await approveTemplates(); await db.query("select public.set_booking_audio_flow(true)"); }
async function book(email: string, hours = 48, extras: Record<string, unknown> = {}) {
  const at = Date.now();
  const event = { uid: randomUUID(), previousUid: null, event: "BOOKING_CREATED", eventAt: new Date(at).toISOString(), email,
    startTime: new Date(at + hours * 3600_000).toISOString(), endTime: new Date(at + hours * 3600_000 + 2700_000).toISOString(),
    timeZone: "Europe/Madrid", meetingUrl: "https://meet.google.com/abc-defg-hij", ...extras };
  const result = (await db.query("select public.record_cal_booking($1) as result", [JSON.stringify(event)])).rows[0].result;
  return { event, result };
}
async function job(uid: string, step: string) {
  return (await db.query("select * from public.followup_jobs where booking_uid=$1 and step=$2 order by booking_revision desc limit 1", [uid, step])).rows[0];
}
async function due(id: string) { await db.query("update public.followup_jobs set scheduled_at=clock_timestamp()-interval '1 second' where id=$1", [id]); }
async function claim(id: string) { return (await db.query("select public.claim_followup_job($1,true,true) as result", [id])).rows[0].result; }
async function send(id: string, outcome = "sent") {
  const claimed = await claim(id);
  expect(claimed.action).toBe("claimed");
  await db.query("select public.finish_followup_job($1,$2,$3,$4,$5)", [id, claimed.claimToken, outcome, outcome === "sent" ? `wamid.${randomUUID()}` : null, outcome === "sent" ? null : "meta_131000_http_400"]);
  return claimed.message;
}
async function reply(phone: string, extras: { buttonJobId?: string | null; oks?: boolean; confirms?: boolean; at?: number } = {}) {
  const message = { id: `wamid.${randomUUID()}`, phone, receivedAt: new Date(extras.at ?? Date.now() + 1000).toISOString(),
    confirms: extras.confirms ?? false, optsOut: false, oks: extras.oks ?? false, buttonJobId: extras.buttonJobId ?? null };
  await db.query("select public.record_whatsapp_replies($1)", [JSON.stringify([message])]);
  return message;
}
async function booking(uid: string) {
  return (await db.query("select whatsapp_flow,ok_received_at,confirmed_at,revision from public.call_bookings where uid=$1", [uid])).rows[0];
}
async function audioJobs(uid: string, step = "booking_audio_1") {
  return (await db.query("select * from public.followup_jobs where booking_uid=$1 and step=$2", [uid, step])).rows;
}
// OK request sent and OK pressed: the usual starting point of the audio flow.
async function okReceived(hours = 48, extras: Record<string, unknown> = {}) {
  const person = await contact();
  await activate();
  const { event } = await book(person.email, hours, extras);
  const request = await job(event.uid, "booking_ok_request");
  await send(request.id);
  await reply(person.phone, { buttonJobId: request.id, oks: true });
  return { person, event, request };
}

describe("contact step", () => {
  it.each([[false, false, []], [true, false, ["email_1", "email_2", "email_3", "email_4"]], [false, true, ["webinar_1d", "webinar_1h", "webinar_3d"]]] as const)(
    "starts only the authorised sequences email=%s whatsapp=%s", async (mail, whatsapp, steps) => {
      const person = await contact({ mail, whatsapp });
      expect(person.result.outcome).toBe("created");
      const lead = (await db.query("select name,phone,whatsapp_consent,whatsapp_consent_version,communications_consent,communications_consent_version from public.leads where idempotency_key=$1", [person.key])).rows[0];
      expect(lead).toEqual({ name: "Lucía", phone: person.phone, whatsapp_consent: whatsapp, whatsapp_consent_version: whatsapp ? "2026-10-14-v1" : null,
        communications_consent: mail, communications_consent_version: mail ? "2026-10-12-v1" : null });
      expect((await jobs((await registrationOf(person.email)).id)).map(row => row.step)).toEqual([...steps].sort());
      // The legacy welcome trigger must not queue anything for the new contact step.
      expect((await db.query("select count(*)::int as n from public.whatsapp_messages m join public.leads l on l.id=m.lead_id where l.idempotency_key=$1", [person.key])).rows[0].n).toBe(0);
    });
  it("replays the same submission and rejects changed data under the same key", async () => {
    const person = await contact();
    expect((await contact({ key: person.key, email: person.email, phone: person.phone })).result.outcome).toBe("replayed");
    expect((await contact({ key: person.key, email: person.email, phone: person.phone, name: "Otra persona" })).result.outcome).toBe("conflict");
    expect((await contact({ key: person.key, email: person.email, phone: person.phone, mail: true })).result.outcome).toBe("conflict");
  });
  it("keeps a returning email's jobs, adds a newly authorised channel and carries earlier consent", async () => {
    const first = await contact({ mail: true, whatsapp: false });
    const registration = await registrationOf(first.email);
    await db.query("update public.followup_jobs set status='sent',sent_at=clock_timestamp(),provider_message_id='re_1' where registration_id=$1 and step='email_1'", [registration.id]);
    const second = await contact({ email: first.email, phone: first.phone, mail: false, whatsapp: true });
    const now = await registrationOf(first.email);
    expect(now.id).toBe(registration.id);
    expect(now.lead_id).not.toBe(registration.lead_id);
    const rows = await jobs(registration.id);
    expect(rows.filter(row => row.step.startsWith("email_"))).toHaveLength(4);
    expect(rows.find(row => row.step === "email_1")?.status).toBe("sent");
    expect(rows.filter(row => row.step.startsWith("webinar_"))).toHaveLength(3);
    expect((await db.query("select communications_consent,whatsapp_consent from public.leads where idempotency_key=$1", [second.key])).rows[0])
      .toEqual({ communications_consent: true, whatsapp_consent: true });
  });
  it("does not carry WhatsApp consent to a different mobile or after BAJA", async () => {
    const first = await contact({ whatsapp: true });
    const other = await contact({ email: first.email, whatsapp: false });
    expect((await db.query("select whatsapp_consent from public.leads where idempotency_key=$1", [other.key])).rows[0].whatsapp_consent).toBe(false);
    await db.query("select public.record_whatsapp_replies($1)", [JSON.stringify([{ id: randomUUID(), phone: first.phone, receivedAt: new Date(Date.now() + 1000).toISOString(), confirms: false, optsOut: true }])]);
    const again = await contact({ email: first.email, phone: first.phone, whatsapp: false });
    expect((await db.query("select whatsapp_consent from public.leads where idempotency_key=$1", [again.key])).rows[0].whatsapp_consent).toBe(false);
  });
  it("saves the seven answers with the situation without granting consent", async () => {
    const person = await contact({ whatsapp: false });
    const args = [person.key, "Dirección", SITUATIONS[2], BOOKING_GOALS[0], COMMITMENTS[0], INVESTMENTS[1], "Lidero un equipo.", ADMISSION_DECISIONS[0]];
    const sql = "select public.complete_masterclass_candidate_qualification($1,$2,$3,$4,$5,$6,$7,$8) as result";
    const result = (await db.query(sql, args)).rows[0].result;
    expect(result).toMatchObject({ outcome: "created", lead: { situation: SITUATIONS[2], whatsappConsent: false, name: "Lucía", phone: person.phone } });
    expect((await db.query(sql, args)).rows[0].result.outcome).toBe("replayed");
    expect((await db.query(sql, [...args.slice(0, 2), SITUATIONS[0], ...args.slice(3)])).rows[0].result.outcome).toBe("conflict");
    await expect(db.query(sql, [randomUUID(), ...args.slice(1, 2), "Inventada", ...args.slice(3)])).rejects.toThrow(/Invalid qualification/);
  });
  it("qualifies with profession, situation and goal from the first form", async () => {
    const person = await contact({ whatsapp: false });
    const args = [person.key, "Dirección", SITUATIONS[2], GOALS[0]];
    const sql = "select public.complete_masterclass_profile($1,$2,$3,$4) as result";
    expect((await db.query(sql, args)).rows[0].result).toMatchObject({ outcome: "created", lead: { profession: "Dirección", situation: SITUATIONS[2], goal: GOALS[0], whatsappConsent: false, name: "Lucía" } });
    expect((await db.query("select qualified_at,commitment from public.leads where idempotency_key=$1", [person.key])).rows[0]).toEqual({ qualified_at: expect.any(Date), commitment: null });
    expect((await db.query(sql, args)).rows[0].result.outcome).toBe("replayed");
    expect((await db.query(sql, [...args.slice(0, 3), GOALS[1]])).rows[0].result.outcome).toBe("conflict");
    expect((await db.query(sql, [randomUUID(), ...args.slice(1)])).rows[0].result.outcome).toBe("missing");
    await expect(db.query(sql, [person.key, "Dirección", SITUATIONS[2], BOOKING_GOALS[0]])).rejects.toThrow(/Invalid qualification/);
  });
  it("asks email-only registrations to complete the contact step first", async () => {
    const key = randomUUID();
    await db.query("select public.submit_masterclass_email_access($1,$2,false,'v1',$3)", [key, `${key}@example.com`, ipHash()]);
    await db.query("select public.register_webinar($1)", [key]);
    expect((await db.query("select public.complete_masterclass_candidate_qualification($1,'Dirección',$2,$3,$4,$5,'Razón',$6) as result",
      [key, SITUATIONS[0], BOOKING_GOALS[0], COMMITMENTS[0], INVESTMENTS[0], ADMISSION_DECISIONS[0]])).rows[0].result.outcome).toBe("missing");
  });
  it("schedules bookings made before the contact step and stops webinar WhatsApps", async () => {
    const email = `${randomUUID()}@example.com`;
    await activate();
    const { event } = await book(email);
    const person = await contact({ email });
    const registration = await registrationOf(person.email);
    expect((await job(event.uid, "booking_ok_request")).status).toBe("pending");
    expect((await jobs(registration.id)).filter(row => row.step.startsWith("webinar_")).every(row => row.status === "suppressed")).toBe(true);
  });
});

describe("booking flow selection", () => {
  it("keeps the previous messages until the flow is activated, and needs approved templates to activate", async () => {
    const person = await contact();
    await db.query("savepoint refused");
    await expect(db.query("select public.set_booking_audio_flow(true)")).rejects.toThrow(/Approved booking audio templates required/);
    await db.query("rollback to savepoint refused");
    const { event } = await book(person.email);
    expect((await booking(event.uid)).whatsapp_flow).toBe("legacy");
    expect((await db.query("select step from public.followup_jobs where booking_uid=$1 and status='pending' order by step", [event.uid])).rows.map(row => row.step))
      .toEqual(["booking_15m", "booking_24h", "booking_2h", "booking_confirmation"]);
  });
  it("uses OK, 2-hour reminder, second audio and 15-minute reminder for 24 hours or more, without the 24-hour reminder", async () => {
    const person = await contact(); await activate();
    const { event } = await book(person.email, 48);
    expect((await booking(event.uid)).whatsapp_flow).toBe("audio");
    const rows = (await db.query("select j.step,j.status,extract(epoch from j.scheduled_at-b.start_time)::int as offset from public.followup_jobs j join public.call_bookings b on b.uid=j.booking_uid where j.booking_uid=$1 order by j.step", [event.uid])).rows;
    expect(rows.map(row => row.step)).toEqual(["booking_15m", "booking_2h", "booking_audio_2", "booking_ok_request"]);
    expect(rows.every(row => row.status === "pending")).toBe(true);
    expect(Object.fromEntries(rows.filter(row => row.step !== "booking_ok_request").map(row => [row.step, row.offset])))
      .toEqual({ booking_15m: -900, booking_2h: -7200, booking_audio_2: -7140 });
  });
  it("keeps the short-notice rules below 24 hours", async () => {
    const person = await contact(); await activate();
    const { event } = await book(person.email, 23);
    expect((await booking(event.uid)).whatsapp_flow).toBe("legacy");
    expect((await db.query("select step from public.followup_jobs where booking_uid=$1 and status='pending' order by step", [event.uid])).rows.map(row => row.step))
      .toEqual(["booking_15m", "booking_2h", "booking_short_notice"]);
  });
  it("leaves existing bookings with their jobs after activation", async () => {
    const person = await contact();
    const { event } = await book(person.email);
    await activate();
    await book(person.email, 48, { ...event, eventAt: new Date(Date.now() + 1000).toISOString() });
    expect((await booking(event.uid)).whatsapp_flow).toBe("legacy");
    expect(await audioJobs(event.uid, "booking_ok_request")).toHaveLength(0);
  });
  it("sends name, date, local time and Meet with the OK template, and a fallback text without Meet", async () => {
    const person = await contact(); await activate();
    const { event } = await book(person.email, 48, { meetingUrl: null });
    const claimed = await claim((await job(event.uid, "booking_ok_request")).id);
    expect(claimed.action).toBe("claimed");
    expect(claimed.message).toMatchObject({ kind: "template", templateName: "reserva_recibida_ok", templateLanguage: "es", parameters: ["name", "date", "time", "meetingUrl"],
      name: "Lucía", meetingUrl: null, timeZone: "Europe/Madrid", phone: person.phone });
    expect(Date.parse(claimed.message.startTime)).toBe(Date.parse(event.startTime));
    const reminder = await job(event.uid, "booking_2h"); await due(reminder.id);
    expect((await claim(reminder.id)).action).toBe("missing_meeting_url");
  });
});

describe("OK, audios and confirmation", () => {
  it("records OK once and queues the first audio only once for duplicate OKs", async () => {
    const { person, event, request } = await okReceived();
    const first = (await booking(event.uid)).ok_received_at;
    expect(first).toBeInstanceOf(Date);
    expect((await booking(event.uid)).confirmed_at).toBeNull();
    await reply(person.phone, { buttonJobId: request.id, oks: true, at: Date.now() + 5000 });
    await reply(person.phone, { oks: true, at: Date.now() + 6000 });
    expect((await booking(event.uid)).ok_received_at).toEqual(first);
    expect(await audioJobs(event.uid)).toHaveLength(1);
  });
  it("sends the first audio without a template and asks for confirmation two hours after Meta accepts it", async () => {
    const { event } = await okReceived();
    const audio = (await audioJobs(event.uid))[0];
    const message = await send(audio.id);
    expect(message).toMatchObject({ kind: "audio", step: "booking_audio_1", templateName: null });
    const request = (await db.query("select status,extract(epoch from scheduled_at-(select sent_at from public.followup_jobs where id=$2))::int as delay from public.followup_jobs where booking_uid=$1 and step='booking_confirm_request'", [event.uid, audio.id])).rows;
    expect(request).toEqual([{ status: "pending", delay: 7200 }]);
  });
  it("does not ask for confirmation when the first audio fails", async () => {
    const { event } = await okReceived();
    await send((await audioJobs(event.uid))[0].id, "failed");
    expect(await audioJobs(event.uid, "booking_confirm_request")).toHaveLength(0);
  });
  it("skips the confirmation request after an early confirmation", async () => {
    const { person, event } = await okReceived();
    await reply(person.phone, { confirms: true, at: Date.now() + 2000 });
    expect((await booking(event.uid)).confirmed_at).toBeInstanceOf(Date);
    await send((await audioJobs(event.uid))[0].id);
    expect((await audioJobs(event.uid, "booking_confirm_request"))[0]).toMatchObject({ status: "suppressed", last_error: "already_confirmed" });
  });
  it("records CONFIRMAR from the confirmation button and skips a pending request confirmed meanwhile", async () => {
    const { person, event } = await okReceived();
    await send((await audioJobs(event.uid))[0].id);
    const request = (await audioJobs(event.uid, "booking_confirm_request"))[0];
    await due(request.id);
    const claimed = await send(request.id);
    expect(claimed.templateName).toBe("reserva_confirmar_asistencia");
    await reply(person.phone, { buttonJobId: request.id, confirms: true, at: Date.now() + 3000 });
    expect((await booking(event.uid)).confirmed_at).toBeInstanceOf(Date);
    const other = await okReceived();
    await send((await audioJobs(other.event.uid))[0].id);
    const pending = (await audioJobs(other.event.uid, "booking_confirm_request"))[0];
    await reply(other.person.phone, { confirms: true, at: Date.now() + 3000 });
    await due(pending.id);
    expect((await claim(pending.id)).action).toBe("skip");
    expect((await db.query("select last_error from public.followup_jobs where id=$1", [pending.id])).rows[0].last_error).toBe("already_confirmed");
  });
  it("ignores buttons from another phone or from a rescheduled booking", async () => {
    const person = await contact(); await activate();
    const { event } = await book(person.email);
    const request = await job(event.uid, "booking_ok_request");
    await send(request.id);
    await reply(phoneNumber(), { buttonJobId: request.id, oks: true });
    expect((await booking(event.uid)).ok_received_at).toBeNull();
    const moved = await book(person.email, 72, { uid: randomUUID(), previousUid: event.uid, event: "BOOKING_RESCHEDULED", eventAt: new Date(Date.now() + 1000).toISOString() });
    await reply(person.phone, { buttonJobId: request.id, oks: true, at: Date.now() + 2000 });
    expect(await audioJobs(event.uid)).toHaveLength(0);
    expect(await audioJobs(moved.event.uid)).toHaveLength(0);
    expect((await booking(moved.event.uid)).ok_received_at).toBeNull();
    expect((await job(moved.event.uid, "booking_ok_request")).status).toBe("pending");
  });
  it("resets OK when the same booking changes time and invalidates the earlier revision's jobs", async () => {
    const { event, person } = await okReceived();
    const audio = (await audioJobs(event.uid))[0];
    const later = Date.now() + 96 * 3600_000;
    await book(person.email, 0, { ...event, eventAt: new Date(Date.now() + 2000).toISOString(), startTime: new Date(later).toISOString(), endTime: new Date(later + 2700_000).toISOString() });
    expect(await booking(event.uid)).toMatchObject({ ok_received_at: null, revision: 2, whatsapp_flow: "audio" });
    expect((await db.query("select status,last_error from public.followup_jobs where id=$1", [audio.id])).rows[0]).toEqual({ status: "suppressed", last_error: "booking_changed" });
    expect((await job(event.uid, "booking_ok_request")).booking_revision).toBe(2);
  });
  it("stops pending audios after a cancellation", async () => {
    const { event, person } = await okReceived();
    const audio = (await audioJobs(event.uid))[0];
    await book(person.email, 48, { ...event, event: "BOOKING_CANCELLED", eventAt: new Date(Date.now() + 2000).toISOString() });
    expect((await db.query("select status from public.followup_jobs where booking_uid=$1 and status='pending'", [event.uid])).rows).toHaveLength(0);
    expect((await claim(audio.id)).action).toBe("skip");
  });
  it("sends the second audio only after OK and inside the 24-hour window; the Meet reminder is still sent", async () => {
    const { event, person } = await okReceived(3 * 24);
    const second = (await audioJobs(event.uid, "booking_audio_2"))[0];
    const reminder = await job(event.uid, "booking_2h");
    await db.query("update private.followup_replies set received_at=received_at-interval '25 hours' where phone=$1", [person.phone]);
    await due(second.id); await due(reminder.id);
    expect((await claim(second.id)).action).toBe("skip");
    expect((await db.query("select last_error from public.followup_jobs where id=$1", [second.id])).rows[0].last_error).toBe("whatsapp_window_closed");
    expect((await send(reminder.id)).templateName).toBe("recordatorio_reunion_2h");

    const open = await okReceived(3 * 24);
    const audio = (await audioJobs(open.event.uid, "booking_audio_2"))[0];
    await due(audio.id);
    expect((await send(audio.id)).kind).toBe("audio");
  });
  it("skips the second audio when no OK was received", async () => {
    const person = await contact(); await activate();
    const { event } = await book(person.email);
    const second = (await audioJobs(event.uid, "booking_audio_2"))[0];
    await reply(person.phone, { at: Date.now() + 1000 });
    await due(second.id);
    expect((await claim(second.id)).action).toBe("skip");
    expect((await db.query("select last_error from public.followup_jobs where id=$1", [second.id])).rows[0].last_error).toBe("ok_not_received");
  });
  it("accepts a typed OK only when a single booking is waiting for it", async () => {
    const person = await contact(); await activate();
    const first = await book(person.email);
    await send((await job(first.event.uid, "booking_ok_request")).id);
    const second = await book(person.email, 72);
    await send((await job(second.event.uid, "booking_ok_request")).id);
    await reply(person.phone, { oks: true, at: Date.now() + 1000 });
    expect((await booking(first.event.uid)).ok_received_at).toBeNull();
    expect((await booking(second.event.uid)).ok_received_at).toBeNull();
    await book(person.email, 72, { ...second.event, event: "BOOKING_CANCELLED", eventAt: new Date(Date.now() + 2000).toISOString() });
    await reply(person.phone, { oks: true, at: Date.now() + 3000 });
    expect((await booking(first.event.uid)).ok_received_at).toBeInstanceOf(Date);
    expect(await audioJobs(first.event.uid)).toHaveLength(1);
  });
});
