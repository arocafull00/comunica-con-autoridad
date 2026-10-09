import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import pg from "pg";
import messages from "../../lib/followups/messages.json";
import { whatsappAutomations } from "../../lib/followups/whatsapp-automations";

const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname)) throw new Error("Local DB only");
const db = new pg.Client({ connectionString: target });
let connected = false;
beforeEach(async () => { if (!connected) { await db.connect(); connected = true; } await db.query("begin"); });
afterEach(async () => { await db.query("rollback"); });
afterAll(async () => { await db.end(); });

async function book(hours: number) {
  const key = randomUUID(); const email = `${key}@example.com`;
  await db.query("select public.submit_lead($1,'María','+34612345678',$2,true,'v1',repeat('a',64))", [key, email]);
  const registration = (await db.query("select public.register_webinar($1) as id", [key])).rows[0].id;
  const eventAt = Date.now(); const uid = randomUUID();
  const event = { event: "BOOKING_CREATED", uid, email, eventAt: new Date(eventAt).toISOString(),
    startTime: new Date(eventAt + hours * 3600_000).toISOString(), endTime: new Date(eventAt + hours * 3600_000 + 2700_000).toISOString(),
    timeZone: "Europe/Madrid", meetingUrl: "https://meet.google.com/abc-defg-hij" };
  await db.query("select public.record_cal_booking($1)", [JSON.stringify(event)]);
  return { uid, registration, event };
}
function provider(key: keyof typeof messages, name = key as string, status = "APPROVED") {
  const body = messages[key].body.replace("{{name}}", "{{1}}").replace("{{meetingUrl}}", "{{1}}");
  return { name, language: "es", body, meta_status: status, approved: status === "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: body }] };
}
async function sync(templates: ReturnType<typeof provider>[]) {
  await db.query("select public.sync_whatsapp_templates($1)", [JSON.stringify(templates)]);
}

describe("fixed WhatsApp triggers", () => {
  it("stores exactly the eight messages shown in the panel, with only name and Meet variables", async () => {
    const rows = (await db.query("select key,body,parameter from public.followup_steps where channel='whatsapp'")).rows;
    expect(rows).toHaveLength(8);
    for (const definition of whatsappAutomations) {
      const row = rows.find((r) => r.key === definition.key);
      expect(row.body).toBe(messages[definition.key].body);
      expect(row.parameter).toBe(definition.key === "webinar_1h" ? "name" : definition.key === "booking_2h" ? "meetingUrl" : null);
    }
  });
  it.each([
    [48, ["booking_confirmation", "booking_24h", "booking_2h", "booking_15m"]],
    [23, ["booking_short_notice", "booking_2h", "booking_15m"]],
    [3, ["booking_short_notice", "booking_2h", "booking_15m"]],
    [1, ["booking_15m"]],
    [0.1, []],
  ] as const)("chooses one fixed sequence for a booking %s hours away", async (hours, expected) => {
    const { uid, event } = await book(hours);
    await db.query("select public.record_cal_booking($1)", [JSON.stringify(event)]);
    const jobs = (await db.query("select step,status,last_error from public.followup_jobs where booking_uid=$1", [uid])).rows;
    expect(jobs).toHaveLength(5);
    expect(jobs.filter((j) => j.status === "pending").map((j) => j.step).sort()).toEqual([...expected].sort());
    if (hours < 2) expect(jobs.filter((j) => j.step !== "booking_15m")).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "suppressed", last_error: "not_needed_short_notice" }),
    ]));
    expect(jobs.some((j) => j.step === "booking_confirmation" && j.status === "pending") &&
      jobs.some((j) => j.step === "booking_short_notice" && j.status === "pending")).toBe(false);
  });
  it("uses booking time when a delayed webhook is processed within the final 24 hours", async () => {
    const { uid, event } = await book(23);
    await db.query("delete from public.followup_jobs where booking_uid=$1", [uid]);
    await db.query("update public.call_bookings set last_event_at=$2::timestamptz-interval '2 hours' where uid=$1", [uid, event.eventAt]);
    await db.query("select private.schedule_call_followups($1)", [uid]);
    expect((await db.query("select step from public.followup_jobs where booking_uid=$1 and status='pending' and step in ('booking_confirmation','booking_short_notice')", [uid])).rows).toEqual([{ step: "booking_confirmation" }]);
  });
  it("does not cancel an unconfirmed booking and cancels reminders only after a Cal cancellation", async () => {
    const { uid, event } = await book(1);
    expect((await db.query("select status,confirmed_at from public.call_bookings where uid=$1", [uid])).rows[0]).toEqual({ status: "booked", confirmed_at: null });
    await db.query("select public.record_cal_booking($1)", [JSON.stringify({ ...event, event: "BOOKING_CANCELLED", eventAt: new Date(Date.now() + 1000).toISOString() })]);
    expect((await db.query("select count(*)::int as n from public.followup_jobs where booking_uid=$1 and status='pending'", [uid])).rows[0].n).toBe(0);
  });
  it("suppresses an earlier retry payload rather than sending it with changed variables", async () => {
    const { uid } = await book(48);
    const job = (await db.query("update public.followup_jobs set payload=$2::jsonb where booking_uid=$1 and step='booking_24h' returning id", [uid, JSON.stringify({ body: "Mañana a las {{time}}", parameter: "time" })])).rows[0];
    expect((await db.query("select public.claim_followup_job($1,true,true) as result", [job.id])).rows[0].result.action).toBe("skip");
    expect((await db.query("select status,last_error from public.followup_jobs where id=$1", [job.id])).rows[0]).toEqual({ status: "suppressed", last_error: "automation_content_changed" });
  });
});

describe("automatic fixed-template bindings", () => {
  beforeEach(async () => { await db.query("delete from private.followup_templates"); });
  it("binds exact copy, retains pending status and never swaps to another matching name", async () => {
    await sync([provider("booking_24h", "fixed_reminder", "PENDING")]);
    let rows = (await db.query("select * from public.read_whatsapp_automation_catalog() where key='booking_24h'")).rows;
    expect(rows[0]).toMatchObject({ template_name: "fixed_reminder", meta_status: "PENDING", ready: false });
    await sync([provider("booking_24h", "fixed_reminder")]);
    expect((await db.query("select approved from private.followup_templates where step='booking_24h'")).rows[0].approved).toBe(true);
    await sync([provider("booking_24h", "replacement")]);
    rows = (await db.query("select * from public.read_whatsapp_automation_catalog() where key='booking_24h'")).rows;
    expect(rows[0]).toMatchObject({ template_name: "fixed_reminder", meta_status: "UNAVAILABLE", ready: false });
  });
  it("does not bind duplicate candidates or approve an edited body or additional components", async () => {
    await sync([provider("webinar_1h", "first"), provider("webinar_1h", "second")]);
    expect((await db.query("select * from private.followup_templates where step='webinar_1h'")).rows).toHaveLength(0);
    await sync([provider("webinar_1h", "first")]);
    await sync([{ ...provider("webinar_1h", "first"), body: "Otro mensaje" }]);
    expect((await db.query("select approved from private.followup_templates where step='webinar_1h'")).rows[0].approved).toBe(false);
    await sync([{ ...provider("webinar_1h", "first"), components: [{ type: "BODY", text: provider("webinar_1h").body }, { type: "HEADER", text: "Cabecera" }] }]);
    expect((await db.query("select approved from private.followup_templates where step='webinar_1h'")).rows[0].approved).toBe(false);
  });
  it("activates fixed automation without selecting a welcome and rejects stale revisions", async () => {
    await sync([provider("booking_15m")]);
    const actor = randomUUID();
    await db.query("insert into auth.users(id,email) values($1,$2)", [actor, `${actor}@example.com`]);
    await db.query("insert into public.admin_accounts(user_id) values($1)", [actor]);
    await db.query("update public.whatsapp_settings set enabled=false,template_id=null");
    const { revision } = (await db.query("select revision from public.whatsapp_settings")).rows[0];
    expect((await db.query("select public.set_whatsapp_delivery($1,$2,true) as result", [actor, revision])).rows[0].result.outcome).toBe("saved");
    expect((await db.query("select enabled,template_id from public.whatsapp_settings")).rows[0]).toEqual({ enabled: true, template_id: null });
    expect((await db.query("select public.set_whatsapp_delivery($1,$2,false) as result", [actor, revision])).rows[0].result.outcome).toBe("conflict");
  });
  it("prevents browser roles from reading private mappings or changing delivery", async () => {
    await db.query("set local role authenticated");
    for (const sql of ["select * from public.read_whatsapp_automation_catalog()", "select public.set_whatsapp_delivery(gen_random_uuid(),0,true)", "update public.followup_steps set body='Otro texto'"]) {
      await db.query("savepoint restricted");
      await expect(db.query(sql)).rejects.toThrow(/permission denied/);
      await db.query("rollback to savepoint restricted");
    }
  });
});
