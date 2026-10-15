import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname)) throw new Error("Local database only");
const pool = new pg.Pool({ connectionString: target });
let db: pg.PoolClient;
beforeEach(async () => { db = await pool.connect(); await db.query("begin"); });
afterEach(async () => { await db.query("rollback"); db.release(); });
afterAll(async () => { await pool.end(); });

describe("saved campaigns", () => {
  it("lists campaigns with the web requests that arrived through them", async () => {
    await db.query("insert into public.campaigns(utm_source,utm_medium,utm_campaign) values ('instagram','paid','prueba_campanas')");
    await db.query(`insert into public.leads(name,phone,email,source,utm_source,utm_medium,utm_campaign) values
      ('Prueba','+34612345678','uno@example.com','web','instagram','paid','prueba_campanas'),
      ('Prueba','+34612345678','dos@example.com','web','instagram','organic','prueba_campanas')`);
    const { rows } = await db.query("select public.get_campaigns() as result");
    expect(rows[0].result.find((c: { utm_campaign: string }) => c.utm_campaign === "prueba_campanas"))
      .toMatchObject({ utm_source: "instagram", utm_medium: "paid", leads: 1 });
  });
  it("rejects duplicates and unnormalized labels and is closed to browsers", async () => {
    await db.query("insert into public.campaigns(utm_source,utm_medium,utm_campaign) values ('instagram','paid','duplicada')");
    await db.query("savepoint duplicate");
    await expect(db.query("insert into public.campaigns(utm_source,utm_medium,utm_campaign) values ('instagram','paid','duplicada')")).rejects.toThrow(/unique/);
    await db.query("rollback to savepoint duplicate");
    await expect(db.query("insert into public.campaigns(utm_source,utm_medium,utm_campaign) values ('Instagram','paid','otra campaña')")).rejects.toThrow(/check constraint/);
    await db.query("rollback to savepoint duplicate");
    const { rows } = await db.query(`select has_table_privilege('anon','public.campaigns','select') as anon,
      has_table_privilege('authenticated','public.campaigns','insert') as authenticated,
      has_function_privilege('anon','public.get_campaigns()','execute') as rpc`);
    expect(rows[0]).toEqual({ anon: false, authenticated: false, rpc: false });
  });
});
