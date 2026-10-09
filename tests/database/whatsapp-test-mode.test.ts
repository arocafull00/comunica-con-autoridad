import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import pg from "pg";

const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname)) throw new Error("Local database only");
const pool = new pg.Pool({ connectionString: target });
const phone = "+34612345678";
let db: pg.PoolClient;
beforeEach(async () => {
  db = await pool.connect(); await db.query("begin");
  await db.query("select public.configure_whatsapp_followup_test($1,true)", [phone]);
});
afterEach(async () => { await db.query("rollback"); db.release(); });
afterAll(async () => { await pool.end(); });

async function register(number = phone, consent = true) {
  const key = randomUUID(); const email = `${key}@example.com`;
  await db.query("select public.submit_lead($1,'Prueba',$2,$3,$4,'v3',$5,null,null,null,'Trabajo','Situación','Objetivo',true)",
    [key, number, email, consent, createHash("sha256").update(key).digest("hex")]);
  const id = (await db.query("select public.register_webinar($1) as id", [key])).rows[0].id;
  return { id, key, email };
}
async function due(id: string, step = "webinar_1h") {
  return (await db.query("update public.followup_jobs set scheduled_at=clock_timestamp()-interval '1 second' where registration_id=$1 and step=$2 returning id", [id, step])).rows[0].id;
}
async function claim(id: string, recipient = phone) {
  return (await db.query("select public.claim_whatsapp_test_job($1,$2) as result", [id, recipient])).rows[0].result;
}
async function book(email: string, meetingUrl: string | null = "https://meet.google.com/test") {
  const event = { uid: randomUUID(), event: "BOOKING_CREATED", eventAt: new Date().toISOString(), email,
    startTime: new Date(Date.now() + 48 * 3600_000).toISOString(), endTime: new Date(Date.now() + 49 * 3600_000).toISOString(),
    timeZone: "Europe/Madrid", meetingUrl };
  await db.query("select public.record_cal_booking($1)", [JSON.stringify(event)]);
  return event;
}

it("marks only WhatsApp jobs for the configured test recipient; repeated registration does not duplicate them", async () => {
  const a = await register(); const b = await register("+34699999999");
  await db.query("select public.register_webinar($1)", [a.key]);
  const jobs = (await db.query("select j.step,j.test_mode,extract(epoch from j.scheduled_at-r.registered_at)::int as delay from public.followup_jobs j join public.webinar_registrations r on r.id=j.registration_id where r.id=$1", [a.id])).rows;
  expect(jobs).toHaveLength(7);
  expect(jobs.filter(j => j.test_mode).map(j => j.delay).sort((a, b) => a - b)).toEqual([60, 180, 300]);
  expect(jobs.find(j => j.step === "email_1")).toMatchObject({ test_mode: false, delay: 60 });
  expect((await db.query("select bool_or(test_mode) as any_test from public.followup_jobs where registration_id=$1", [b.id])).rows[0].any_test).toBe(false);
});

it("cannot claim test jobs through the paid channel or send to another recipient", async () => {
  const a = await register(); const id = await due(a.id);
  expect((await db.query("select public.claim_followup_job($1,true,true) as result", [id])).rows[0].result.action).toBe("paused");
  expect((await claim(id, "+34699999999")).action).toBe("paused");
  expect((await db.query("select id from public.read_followup_jobs(true,true)")).rows.some(j => j.id === id)).toBe(false);
  const result = await claim(id);
  expect(result.message).toMatchObject({ phone, testMode: true, templateName: "hello_world", templateLanguage: "en_US", parameter: null });
  expect((await claim(id)).action).toBe("busy");
});

it("pausing tests never routes their jobs through the paid channel", async () => {
  const a = await register(); const id = await due(a.id);
  await db.query("select public.configure_whatsapp_followup_test($1,false)", [phone]);
  expect((await claim(id)).action).toBe("paused");
  expect((await db.query("select * from public.read_whatsapp_test_jobs($1)", [phone])).rows).toHaveLength(0);
  expect((await db.query("select public.claim_followup_job($1,true,true) as result", [id])).rows[0].result.action).toBe("paused");
});

it("keeps consent, replies and booking suppression in the real claim logic", async () => {
  const noConsent = await register(phone, false);
  expect((await db.query("select count(*)::int as n from public.followup_jobs where registration_id=$1 and test_mode", [noConsent.id])).rows[0].n).toBe(0);
  const a = await register(); const id = await due(a.id);
  await db.query("update public.leads set whatsapp_consent=false where id=(select lead_id from public.webinar_registrations where id=$1)", [a.id]);
  expect((await claim(id)).action).toBe("skip");
  const b = await register(); await book(b.email);
  const suppressed = (await db.query("select status from public.followup_jobs where registration_id=$1 and step='webinar_1h'", [b.id])).rows[0];
  expect(suppressed.status).toBe("suppressed");
  const c = await register(); const last = await due(c.id, "webinar_3d");
  await db.query("select public.record_whatsapp_replies($1)", [JSON.stringify([{ id: randomUUID(), phone, receivedAt: new Date(Date.now() + 1000).toISOString(), confirms: false, optsOut: false }])]);
  expect((await claim(last)).action).toBe("skip");
});

it("booking tests still require a meeting URL and expire or cancel normally", async () => {
  const a = await register(); const event = await book(a.email, null); const id = await due(a.id, "booking_2h");
  expect((await claim(id)).action).toBe("missing_meeting_url");
  await db.query("select public.record_cal_booking($1)", [JSON.stringify({ ...event, event: "BOOKING_CANCELLED", eventAt: new Date(Date.now() + 1000).toISOString() })]);
  expect((await claim(id)).action).toBe("skip");
  const b = await register(); const expired = await due(b.id);
  await db.query("update public.followup_jobs set expires_at=clock_timestamp()-interval '1 second' where id=$1", [expired]);
  expect((await claim(expired)).action).toBe("skip");
});

it("advances only untouched pending sandbox jobs and preserves uncertain-delivery handling", async () => {
  const a = await register(); const id = await due(a.id);
  const scheduled = (await db.query("select public.advance_whatsapp_test_job($1,$2) as at", [phone, id])).rows[0].at;
  expect(scheduled.getTime()).toBeGreaterThan(Date.now() + 55_000);
  await due(a.id); const result = await claim(id);
  await db.query("update public.followup_jobs set processing_started_at=clock_timestamp()-interval '121 seconds' where id=$1", [id]);
  expect((await claim(id)).action).toBe("unknown");
  expect((await db.query("select status,last_error from public.followup_jobs where id=$1", [id])).rows[0]).toEqual({ status: "failed", last_error: "delivery_unknown" });
  expect((await db.query("select public.finish_followup_job($1,$2,'sent','late-provider-id',null) as finished", [id, result.claimToken])).rows[0].finished).toBe(false);
});

it("public and user roles cannot configure or inspect the test queue", async () => {
  for (const role of ["anon", "authenticated"]) {
    const grants = (await db.query("select has_function_privilege($1,'public.configure_whatsapp_followup_test(text,boolean)','execute') as configure,has_function_privilege($1,'public.claim_whatsapp_test_job(uuid,text)','execute') as claim,has_function_privilege($1,'public.whatsapp_test_job_status(text)','execute') as status", [role])).rows[0];
    expect(grants).toEqual({ configure: false, claim: false, status: false });
  }
});
