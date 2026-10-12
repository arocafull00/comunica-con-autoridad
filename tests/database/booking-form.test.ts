import { randomUUID, createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { ADMISSION_DECISIONS, BOOKING_GOALS, COMMITMENTS, INVESTMENTS } from "../../lib/leads/masterclass";

const reasons = "Quiero liderar mejor, hablar con seguridad y comunicar con claridad.";
const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname)) throw new Error("Local database only");
const pool = new pg.Pool({ connectionString: target });
let db: pg.PoolClient;
beforeEach(async () => { db = await pool.connect(); await db.query("begin"); });
afterEach(async () => { await db.query("rollback"); db.release(); });
afterAll(async () => { await pool.end(); });

const capture = async (key: string, email: string, consent = true) => (await db.query(
  "select public.submit_masterclass_email_access($1,$2,$3,'email-v1',$4,null,null,null) as result",
  [key, email, consent, createHash("sha256").update(key).digest("hex")],
)).rows[0].result;
const qualify = async (key: string, name = "Adrián", phone = "+34612345678") => (await db.query(
  "select public.complete_masterclass_qualification_with_contact($1,$2,$3,'whatsapp-v1',$4,$5,$6,$7,$8,$9) as result",
  [key, name, phone, "Dirección", BOOKING_GOALS[0], COMMITMENTS[0], INVESTMENTS[1], reasons, ADMISSION_DECISIONS[0]],
)).rows[0].result;

describe("email access then contact and qualification", () => {
  it("stores only email first, then schedules WhatsApps once the mobile is supplied", async () => {
    const key = randomUUID(); const email = `${key}@example.com`;
    expect(await capture(key, email)).toMatchObject({ outcome: "created", lead: { name: "", phone: null, email } });
    const registration = (await db.query("select public.register_webinar($1) as id", [key])).rows[0].id;
    expect((await db.query("select name,phone,whatsapp_consent,communications_consent from public.leads where idempotency_key=$1", [key])).rows[0])
      .toEqual({ name: null, phone: null, whatsapp_consent: false, communications_consent: true });
    expect((await db.query("select step from public.followup_jobs where registration_id=$1", [registration])).rows.map(row => row.step).sort())
      .toEqual(["email_1", "email_2", "email_3", "email_4"]);
    expect(await qualify(key)).toMatchObject({ outcome: "created", lead: { name: "Adrián", phone: "+34612345678", profession: "Dirección" } });
    expect((await qualify(key)).outcome).toBe("replayed");
    expect((await capture(key, email)).outcome).toBe("replayed");
    expect((await capture(key, "another@example.com")).outcome).toBe("conflict");
    expect((await qualify(key, "Otra persona")).outcome).toBe("conflict");
    expect((await db.query("select step from public.followup_jobs where registration_id=$1 and step like 'webinar_%'", [registration])).rows.map(row => row.step).sort())
      .toEqual(["webinar_1d", "webinar_1h", "webinar_3d"]);
    expect((await db.query("select whatsapp_consent_at,whatsapp_consent_version from public.leads where idempotency_key=$1", [key])).rows[0])
      .toEqual({ whatsapp_consent_at: expect.any(Date), whatsapp_consent_version: "whatsapp-v1" });
  });

  it("keeps promotional email opt-in separate and schedules booking reminders after contact completion", async () => {
    const key = randomUUID(); const email = `${key}@example.com`;
    await capture(key, email, false);
    const registration = (await db.query("select public.register_webinar($1) as id", [key])).rows[0].id;
    expect((await db.query("select count(*)::int as n from public.followup_jobs where registration_id=$1", [registration])).rows[0].n).toBe(0);
    const uid = randomUUID();
    await db.query("select public.record_cal_booking($1)", [JSON.stringify({ uid, event: "BOOKING_CREATED", eventAt: new Date().toISOString(),
      email, startTime: new Date(Date.now() + 48 * 3600_000).toISOString(), endTime: new Date(Date.now() + 49 * 3600_000).toISOString(),
      timeZone: "Europe/Madrid", meetingUrl: "https://meet.google.com/test" })]);
    expect((await db.query("select count(*)::int as n from public.followup_jobs where booking_uid=$1", [uid])).rows[0].n).toBe(0);
    await qualify(key);
    expect((await db.query("select count(*)::int as n from public.followup_jobs where booking_uid=$1 and status='pending'", [uid])).rows[0].n).toBe(4);
    expect((await db.query("select count(*)::int as n from public.followup_jobs where registration_id=$1 and step like 'email_%'", [registration])).rows[0].n).toBe(0);
  });

  it("rejects qualification before registration and partial direct RPC writes", async () => {
    const key = randomUUID(); const email = `${key}@example.com`;
    expect((await qualify(key)).outcome).toBe("missing");
    await capture(key, email);
    expect((await qualify(key)).outcome).toBe("missing");
    await db.query("select public.register_webinar($1)", [key]);
    await db.query("savepoint invalid");
    await expect(db.query("select public.complete_masterclass_qualification_with_contact($1,'Adrián','+34612345678','v1','Dirección',$2,null,$3,$4,$5)",
      [key, BOOKING_GOALS[0], INVESTMENTS[0], reasons, ADMISSION_DECISIONS[0]])).rejects.toThrow("Invalid qualification");
    await db.query("rollback to savepoint invalid");
    expect((await db.query("select name,phone,qualified_at from public.leads where idempotency_key=$1", [key])).rows[0])
      .toEqual({ name: null, phone: null, qualified_at: null });
  });

  it("qualifies a new submission for an existing email without restarting follow-ups", async () => {
    const first = randomUUID(); const second = randomUUID(); const email = `${first}@example.com`;
    await capture(first, email);
    const registration = (await db.query("select public.register_webinar($1) as id", [first])).rows[0].id;
    await qualify(first);
    const jobs = (await db.query("select id,scheduled_at from public.followup_jobs where registration_id=$1 order by id", [registration])).rows;
    await capture(second, email);
    expect((await db.query("select public.register_webinar($1) as id", [second])).rows[0].id).toBe(registration);
    expect(await qualify(second, "Contacto actualizado", "+34623456789")).toMatchObject({ outcome: "created",
      lead: { name: "Contacto actualizado", phone: "+34623456789", email } });
    expect((await db.query("select l.idempotency_key from public.webinar_registrations r join public.leads l on l.id=r.lead_id where r.id=$1", [registration])).rows[0].idempotency_key).toBe(second);
    expect((await db.query("select id,scheduled_at from public.followup_jobs where registration_id=$1 order by id", [registration])).rows).toEqual(jobs);
    expect((await qualify(second, "Contacto actualizado", "+34623456789")).outcome).toBe("replayed");
    // A stale retry must not replace the contact from the newer completed form.
    expect((await qualify(first)).outcome).toBe("replayed");
    expect((await db.query("select l.idempotency_key from public.webinar_registrations r join public.leads l on l.id=r.lead_id where r.id=$1", [registration])).rows[0].idempotency_key).toBe(second);
  });

  it("accepts a returning contact and does not undo BAJA on an idempotent replay", async () => {
    const key = randomUUID(); const email = `${key}@example.com`;
    await db.query("select public.submit_masterclass_access($1,'Adrián','+34612345678',$2,false,false,'v1',$3)",
      [key, email, createHash("sha256").update(key).digest("hex")]);
    const registration = (await db.query("select public.register_webinar($1) as id", [key])).rows[0].id;
    expect(await qualify(key)).toMatchObject({ outcome: "created" });
    expect((await db.query("select count(*)::int as n from public.followup_jobs where registration_id=$1 and step like 'webinar_%'", [registration])).rows[0].n).toBe(3);
    await db.query("update public.leads set whatsapp_consent=false where idempotency_key=$1", [key]);
    expect((await qualify(key)).outcome).toBe("replayed");
    expect((await db.query("select whatsapp_consent from public.leads where idempotency_key=$1", [key])).rows[0].whatsapp_consent).toBe(false);
  });

  it.each(["anon", "authenticated"])("prevents %s from calling the new functions", async role => {
    await db.query(`set local role ${role}`);
    await expect(db.query("select public.submit_masterclass_email_access(null,null,null,null,null)")).rejects.toThrow("permission denied");
    await db.query("rollback"); await db.query("begin"); await db.query(`set local role ${role}`);
    await expect(db.query("select public.complete_masterclass_qualification_with_contact(null,null,null,null,null,null,null,null,null,null)")).rejects.toThrow("permission denied");
  });
});
