import { randomUUID, createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

const connectionString = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(connectionString).hostname)) throw new Error("Database tests require localhost");
const pool = new pg.Pool({ connectionString });
let client: pg.PoolClient;
beforeEach(async () => { client = await pool.connect(); await client.query("begin"); });
afterEach(async () => { await client.query("rollback"); client.release(); });
afterAll(async () => { await pool.end(); });

describe("protected lead metrics", () => {
  it("counts requests and normalized distinct emails across Madrid DST boundaries", async () => {
    // Madrid 29 March 2026 spans 23 hours, not a fixed 24-hour UTC day.
    const fixtures = [
      ["2026-03-28T22:59:59Z", "excluded@example.com", "web"],
      ["2026-03-28T23:00:00Z", "Repeat@example.com", "web"],
      ["2026-03-29T21:59:59Z", " repeat@example.com ", "web"],
      ["2026-03-29T22:00:00Z", "excluded2@example.com", "web"],
      ["2026-03-29T12:00:00Z", "crm@example.com", "crm"],
    ];
    for (const [date, email, source] of fixtures) await client.query(
      "insert into public.leads(name,phone,email,source,created_at,utm_source,utm_medium,utm_campaign) values ('Prueba','+34612345678',$1,$2,$3,'instagram','paid','curso')",
      [email, source, date]);
    const { rows } = await client.query("select public.get_lead_metrics('2026-03-29','2026-03-30') as result");
    expect(rows[0].result).toMatchObject({ leads: 2, unique_emails: 1, whatsapp_consents: 0, timezone: "Europe/Madrid",
      daily: [{ day: "2026-03-29", leads: 2, unique_emails: 1 }],
      campaigns: [{ utm_source: "instagram", utm_medium: "paid", utm_campaign: "curso", leads: 2, unique_emails: 1 }],
    });
    expect(JSON.stringify(rows[0].result)).not.toContain("@example.com");
  });
  it("returns zero totals for empty periods and rejects invalid ranges", async () => {
    const { rows } = await client.query("select public.get_lead_metrics('2080-01-01','2080-01-02') as result");
    expect(rows[0].result).toMatchObject({ leads: 0, unique_emails: 0, daily: [], campaigns: [] });
    for (const dates of [["2026-03-01", "2026-03-01"], ["2026-03-01", "2026-02-28"], ["2020-01-01", "2026-01-01"]]) {
      await client.query("savepoint invalid_range");
      await expect(client.query("select public.get_lead_metrics($1,$2)", dates)).rejects.toThrow(/positive date range/);
      await client.query("rollback to savepoint invalid_range");
    }
  });
  it.each(["anon", "authenticated"])("does not expose reports to %s", async (role) => {
    await client.query(`set local role ${role}`);
    await expect(client.query("select public.get_lead_metrics('2026-01-01','2026-01-02')")).rejects.toThrow(/permission denied/);
  });
  it("preserves old RPC clients and treats campaign changes as different payloads", async () => {
    const key = randomUUID(); const hash = createHash("sha256").update(key).digest("hex");
    const sql = "select public.submit_lead($1,'Prueba','+34612345678','campaign@example.com',false,'v1',$2,$3,'paid','curso') as result";
    expect((await client.query(sql, [key, hash, "instagram"])).rows[0].result.outcome).toBe("created");
    expect((await client.query(sql, [key, hash, "instagram"])).rows[0].result.outcome).toBe("replayed");
    expect((await client.query(sql, [key, hash, "google"])).rows[0].result.outcome).toBe("conflict");
    const { rows } = await client.query("select utm_source,utm_medium,utm_campaign from public.leads where idempotency_key=$1", [key]);
    expect(rows[0]).toEqual({ utm_source: "instagram", utm_medium: "paid", utm_campaign: "curso" });
    expect((await client.query("select public.submit_lead($1,'Prueba','+34612345678','legacy@example.com',false,'v1',$2) as result", [randomUUID(), hash])).rows[0].result.outcome).toBe("created");
  });
});
