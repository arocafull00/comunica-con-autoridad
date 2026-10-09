import { randomUUID, createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { BOOKING_GOALS, COMMITMENTS, INVESTMENTS } from "../../lib/leads/masterclass";

const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname)) throw new Error("Local database only");
const pool = new pg.Pool({ connectionString: target });
let db: pg.PoolClient;
beforeEach(async () => { db = await pool.connect(); await db.query("begin"); });
afterEach(async () => { await db.query("rollback"); db.release(); });
afterAll(async () => { await pool.end(); });
const capture = async (key: string, email: string) => (await db.query(
  "select public.submit_masterclass_access($1,'+34612345678',$2,true,true,'v1',$3) as result",
  [key, email, createHash("sha256").update(key).digest("hex")],
)).rows[0].result;
const qualify = async (key: string, profession = "Dirección") => (await db.query(
  "select public.complete_masterclass_qualification($1,$2,$3,$4,$5) as result",
  [key, profession, BOOKING_GOALS[0], COMMITMENTS[0], INVESTMENTS[1]],
)).rows[0].result;

describe("contact capture then qualification", () => {
  it("keeps one lead, registration and welcome across both phases and retries", async () => {
    const key = randomUUID(); const email = `${key}@example.com`;
    expect(await capture(key, email)).toMatchObject({ outcome: "created", lead: { name: "", email, profession: null } });
    const registration = (await db.query("select public.register_webinar($1) as id", [key])).rows[0].id;
    const before = (await db.query("select count(*)::int as n from public.followup_jobs where registration_id=$1", [registration])).rows[0].n;
    expect(before).toBeGreaterThan(0);
    expect(await qualify(key)).toMatchObject({ outcome: "created", lead: { profession: "Dirección", goal: BOOKING_GOALS[0], commitment: COMMITMENTS[0], investment: INVESTMENTS[1] } });
    expect((await qualify(key)).outcome).toBe("replayed");
    expect((await capture(key, email)).outcome).toBe("replayed");
    expect((await qualify(key, "Ventas")).outcome).toBe("conflict");
    expect((await db.query("select public.register_webinar($1) as id", [key])).rows[0].id).toBe(registration);
    expect((await db.query("select count(*)::int as n from public.leads where idempotency_key=$1", [key])).rows[0].n).toBe(1);
    expect((await db.query("select count(*)::int as n from public.whatsapp_messages m join public.leads l on m.lead_id=l.id where l.idempotency_key=$1", [key])).rows[0].n).toBe(1);
    expect((await db.query("select count(*)::int as n from public.followup_jobs where registration_id=$1", [registration])).rows[0].n).toBe(before);
  });
  it("rejects qualification before registration and rejects partial direct RPC writes", async () => {
    const key = randomUUID(); const email = `${key}@example.com`;
    expect((await qualify(key)).outcome).toBe("missing");
    await capture(key, email);
    expect((await qualify(key)).outcome).toBe("missing");
    await db.query("select public.register_webinar($1)", [key]);
    await db.query("savepoint invalid");
    await expect(db.query("select public.complete_masterclass_qualification($1,'Dirección',$2,null,$3)", [key, BOOKING_GOALS[0], INVESTMENTS[0]])).rejects.toThrow("Invalid qualification");
    await db.query("rollback to savepoint invalid");
    expect((await db.query("select profession,qualified_at from public.leads where idempotency_key=$1", [key])).rows[0]).toEqual({ profession: null, qualified_at: null });
  });
  it.each(["anon", "authenticated"])("prevents %s from bypassing server validation", async role => {
    await db.query(`set local role ${role}`);
    await expect(db.query("select public.complete_masterclass_qualification(null,null,null,null,null)")).rejects.toThrow("permission denied");
  });
});
