import { randomUUID, createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { ADMISSION_DECISIONS, BOOKING_GOALS, COMMITMENTS, INVESTMENTS, SITUATIONS } from "../../lib/leads/masterclass";

const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname)) throw new Error("Local database only");
const pool = new pg.Pool({ connectionString: target });
let db: pg.PoolClient;
beforeEach(async () => { db = await pool.connect(); await db.query("begin"); });
afterEach(async () => { await db.query("rollback"); db.release(); });
afterAll(async () => { await pool.end(); });

const contact = async (key: string) => (await db.query(
  "select public.submit_masterclass_contact($1,'Adrián','+34612345678',$2,false,false,null,null,$3) as result",
  [key, `${key}@example.com`, createHash("sha256").update(key).digest("hex")],
)).rows[0].result;
const progress = async (key: string, step: number, answers: object) => (await db.query(
  "select public.save_masterclass_progress($1,$2,$3) as result", [key, step, JSON.stringify(answers)])).rows[0].result;
const lead = async (key: string) => (await db.query(
  "select qualification_step,qualification_draft,qualification_progress_at,qualified_at from public.leads where idempotency_key=$1", [key])).rows[0];

describe("anonymous class funnel", () => {
  it("counts each session once per step inside the Madrid date range", async () => {
    const [first, second] = [randomUUID(), randomUUID()];
    for (const [session, event] of [[first, "visit"], [first, "visit"], [first, "video_play"], [second, "visit"]]) {
      await db.query("select public.record_funnel_event($1,$2)", [session, event]);
    }
    await db.query("insert into private.funnel_events(session_id,event,created_at) values ($1,'visit','2026-03-28T22:59:59Z')", [randomUUID()]);
    const today = (await db.query("select (now() at time zone 'Europe/Madrid')::date as day")).rows[0].day;
    const { rows } = await db.query("select public.get_funnel_metrics($1::date,$1::date+1) as result", [today]);
    expect(rows[0].result).toMatchObject({ visit: 2, video_play: 1 });
    expect((await db.query("select public.get_funnel_metrics('2080-01-01','2080-01-02') as result")).rows[0].result).toEqual({});
  });
  it("rejects unknown events and is not callable by browsers", async () => {
    await db.query("savepoint invalid_event");
    await expect(db.query("select public.record_funnel_event($1,'email')", [randomUUID()])).rejects.toThrow(/check constraint/);
    await db.query("rollback to savepoint invalid_event");
    const { rows } = await db.query(`select has_function_privilege('anon','public.record_funnel_event(uuid,text)','execute') as anon,
      has_function_privilege('authenticated','public.get_funnel_metrics(date,date)','execute') as authenticated,
      has_function_privilege('anon','public.save_masterclass_progress(uuid,integer,jsonb)','execute') as progress`);
    expect(rows[0]).toEqual({ anon: false, authenticated: false, progress: false });
  });
});

describe("per-contact form progress", () => {
  it("keeps the furthest question and merges answers until the form is completed", async () => {
    const key = randomUUID();
    expect(await contact(key)).toMatchObject({ outcome: "created" });
    expect(await lead(key)).toMatchObject({ qualification_step: null, qualification_draft: null });
    expect(await progress(key, 1, {})).toEqual({ outcome: "saved" });
    expect(await progress(key, 3, { profession: "Ventas", situation: SITUATIONS[1] })).toEqual({ outcome: "saved" });
    expect(await progress(key, 2, { profession: "Dirección" })).toEqual({ outcome: "saved" });
    expect(await lead(key)).toMatchObject({ qualification_step: 3, qualification_draft: { profession: "Dirección", situation: SITUATIONS[1] } });
    await db.query("select public.complete_masterclass_candidate_qualification($1,'Dirección',$2,$3,$4,$5,'Quiero liderar mejor.',$6)",
      [key, SITUATIONS[1], BOOKING_GOALS[0], COMMITMENTS[0], INVESTMENTS[1], ADMISSION_DECISIONS[0]]);
    expect(await progress(key, 7, { goal: BOOKING_GOALS[1] })).toEqual({ outcome: "completed" });
    expect(await lead(key)).toMatchObject({ qualification_step: 3, qualified_at: expect.any(Date) });
    expect(await progress(randomUUID(), 1, {})).toEqual({ outcome: "missing" });
  });
  it("rejects steps outside the seven questions", async () => {
    const key = randomUUID();
    await contact(key);
    for (const step of [0, 8]) {
      await db.query("savepoint invalid_step");
      await expect(progress(key, step, {})).rejects.toThrow(/Invalid progress/);
      await db.query("rollback to savepoint invalid_step");
    }
  });
});
