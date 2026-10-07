import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import pg from "pg";

const connectionString = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const target = new URL(connectionString);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("Database tests are restricted to localhost");
const pool = new pg.Pool({ connectionString, max: 12 });
let client: pg.PoolClient;
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
const submit = async (connection: pg.PoolClient, key = randomUUID(), consent = true, ipHash = hash(), name = "Adrián") => {
  const { rows } = await connection.query("select public.submit_lead($1,$2,$3,$4,$5,$6,$7) as result", [key, name, "+34612345678", "test@example.com", consent, "2026-10-06-v1", ipHash]);
  return rows[0].result;
};
const jobFor = async (key: string) => {
  const { rows } = await client.query("select q.msg_id::text as queue_id, m.id from public.leads l join public.whatsapp_messages m on m.lead_id=l.id join pgmq.q_whatsapp_outbound q on q.message->>'messageId'=m.id::text where l.idempotency_key=$1", [key]);
  return rows[0] as { queue_id: string; id: string };
};
const claimJob = async (queueId: string) => (await client.query("select public.claim_whatsapp_job($1,'welcome','es','v99.0') as result", [queueId])).rows[0].result;
const finish = async (job: { queue_id: string; id: string }, token: string, outcome: string, provider: string | null = null) =>
  (await client.query("select public.finish_whatsapp_job($1,$2,$3,$4,$5,'test_error') as result", [job.queue_id, job.id, token, outcome, provider])).rows[0].result;

beforeEach(async () => { client = await pool.connect(); await client.query("begin"); });
afterEach(async () => { await client.query("rollback"); client.release(); });
afterAll(async () => { await pool.end(); });

describe("local migrations, triggers and lead API transaction", () => {
  it("stores masterclass answers atomically and includes them in idempotent replay checks", async () => {
    const key = randomUUID();
    const args = [key, hash(), "Dirección", "Lidero un equipo o tengo personas a mi cargo.", "Transmitir más seguridad, autoridad y confianza al comunicar."];
    const sql = "select public.submit_lead($1,'Prueba','+34612345678','masterclass@example.com',false,'v1',$2,null,null,null,$3,$4,$5) as result";
    expect((await client.query(sql, args)).rows[0].result.outcome).toBe("created");
    expect((await client.query(sql, args)).rows[0].result.outcome).toBe("replayed");
    expect((await client.query(sql, [key, args[1], "Ventas", args[3], args[4]])).rows[0].result.outcome).toBe("conflict");
    const { rows } = await client.query("select profession,situation,goal from public.leads where idempotency_key=$1", [key]);
    expect(rows).toEqual([{ profession: args[2], situation: args[3], goal: args[4] }]);
  });
  it("stores consent evidence and exactly one durable job", async () => {
    const key = randomUUID();
    expect((await submit(client, key)).outcome).toBe("created");
    const { rows } = await client.query("select l.*, (select count(*) from public.whatsapp_messages m where m.lead_id=l.id)::int as messages from public.leads l where idempotency_key=$1", [key]);
    expect(rows[0]).toMatchObject({ whatsapp_consent: true, whatsapp_consent_version: "2026-10-06-v1", messages: 1 });
    expect(rows[0].whatsapp_consent_at).toBeInstanceOf(Date);
    expect(await jobFor(key)).toBeTruthy();
    const persistence = await client.query("select relpersistence from pg_class where oid='pgmq.q_whatsapp_outbound'::regclass");
    expect(persistence.rows[0].relpersistence).toBe("p");
  });
  it("stores non-consenting leads without any welcome job", async () => {
    const key = randomUUID();
    await submit(client, key, false);
    expect(await jobFor(key)).toBeUndefined();
    const { rows } = await client.query("select whatsapp_consent_at, whatsapp_consent_version from public.leads where idempotency_key=$1", [key]);
    expect(rows[0]).toEqual({ whatsapp_consent_at: null, whatsapp_consent_version: null });
  });
  it("replays same content and conflicts on changed content", async () => {
    const key = randomUUID();
    await submit(client, key);
    expect((await submit(client, key)).outcome).toBe("replayed");
    expect((await submit(client, key, true, hash(), "Otra persona")).outcome).toBe("conflict");
    expect((await client.query("select count(*)::int as n from public.leads where idempotency_key=$1", [key])).rows[0].n).toBe(1);
  });
  it("enforces a rolling five-request window and permits idempotent replays", async () => {
    const ip = hash();
    const keys = Array.from({ length: 5 }, () => randomUUID());
    for (const key of keys) expect((await submit(client, key, false, ip)).outcome).toBe("created");
    expect(await submit(client, randomUUID(), false, ip)).toMatchObject({ outcome: "rate_limited", retry_after: expect.any(Number) });
    expect((await submit(client, keys[0], false, ip)).outcome).toBe("replayed");
    await client.query("update private.lead_request_log set created_at=now()-interval '11 minutes' where ip_hash=$1", [ip]);
    expect((await submit(client, randomUUID(), false, ip)).outcome).toBe("created");
  });
  it("rolls back the lead and rate-limit record if enqueue fails", async () => {
    await client.query("create function pg_temp.reject_welcome() returns trigger language plpgsql as $$begin raise exception 'test queue failure'; end;$$");
    await client.query("create trigger test_reject_welcome before insert on public.whatsapp_messages for each row execute function pg_temp.reject_welcome()");
    const key = randomUUID(); const ip = hash();
    await client.query("savepoint failed_insert");
    await expect(submit(client, key, true, ip)).rejects.toThrow("test queue failure");
    await client.query("rollback to savepoint failed_insert");
    expect((await client.query("select count(*)::int as n from public.leads where idempotency_key=$1", [key])).rows[0].n).toBe(0);
    expect((await client.query("select count(*)::int as n from private.lead_request_log where ip_hash=$1", [ip])).rows[0].n).toBe(0);
  });
  it.each(["anon", "authenticated"])("blocks %s from tables and queue RPCs", async (role) => {
    for (const sql of ["select * from public.leads", "select * from public.whatsapp_messages", "select * from pgmq.q_whatsapp_outbound", "select public.read_whatsapp_jobs()", "select public.submit_lead(null,null,null,null,false,null,null)"]) {
      await client.query("savepoint denied_access");
      await client.query(`set local role ${role}`);
      await expect(client.query(sql)).rejects.toThrow(/permission denied/);
      await client.query("rollback to savepoint denied_access");
    }
    const { rows } = await client.query("select relrowsecurity from pg_class where oid in ('public.leads'::regclass,'public.whatsapp_messages'::regclass)");
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });
  it("worker Cron starts disabled", async () => {
    expect((await client.query("select active from cron.job where jobname='process-whatsapp-queue'")).rows[0].active).toBe(false);
  });
});

describe("durable worker operations", () => {
  it("claims once, snapshots the template, finishes and archives atomically", async () => {
    const key = randomUUID(); await submit(client, key); const job = await jobFor(key);
    const claim = await claimJob(job.queue_id);
    expect(claim.action).toBe("claimed");
    expect((await claimJob(job.queue_id)).action).toBe("busy");
    expect(await finish(job, randomUUID(), "sent", "wamid.test")).toBe(false);
    expect(await finish(job, claim.claim_token, "sent", "wamid.test")).toBe(true);
    expect((await claimJob(job.queue_id)).action).toBe("skip");
    const { rows } = await client.query("select * from public.whatsapp_messages where id=$1", [job.id]);
    expect(rows[0]).toMatchObject({ status: "sent", attempts: 1, provider_message_id: "wamid.test", template_name: "welcome", template_language: "es", graph_api_version: "v99.0" });
    expect((await client.query("select count(*)::int as n from pgmq.a_whatsapp_outbound where msg_id=$1", [job.queue_id])).rows[0].n).toBe(1);
  });
  it("sets 60/300 second retries and fails after the third attempt", async () => {
    const key = randomUUID(); await submit(client, key); const job = await jobFor(key);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claim = await claimJob(job.queue_id); expect(claim.action).toBe("claimed");
      await finish(job, claim.claim_token, "retry");
      const { rows } = await client.query("select status, attempts, extract(epoch from scheduled_at-clock_timestamp()) as delay from public.whatsapp_messages where id=$1", [job.id]);
      expect(rows[0].attempts).toBe(attempt);
      expect(rows[0].status).toBe(attempt === 3 ? "failed" : "pending");
      if (attempt < 3) {
        expect(Number(rows[0].delay)).toBeGreaterThan(attempt === 1 ? 58 : 298);
        expect((await claimJob(job.queue_id)).action).toBe("busy");
        await client.query("update public.whatsapp_messages set scheduled_at=now()-interval '1 second' where id=$1", [job.id]);
      }
    }
  });
  it("rechecks withdrawn consent without sending", async () => {
    const key = randomUUID(); await submit(client, key); const job = await jobFor(key);
    await client.query("update public.leads set whatsapp_consent=false where idempotency_key=$1", [key]);
    expect((await claimJob(job.queue_id)).action).toBe("skip");
    expect((await client.query("select status,last_error,attempts from public.whatsapp_messages where id=$1", [job.id])).rows[0]).toMatchObject({ status: "failed", last_error: "consent_missing", attempts: 0 });
  });
  it("archives interrupted processing as delivery_unknown without another attempt", async () => {
    const key = randomUUID(); await submit(client, key); const job = await jobFor(key);
    await claimJob(job.queue_id);
    await client.query("update public.whatsapp_messages set processing_started_at=now()-interval '121 seconds' where id=$1", [job.id]);
    expect((await claimJob(job.queue_id)).action).toBe("unknown");
    expect((await client.query("select status,last_error,attempts from public.whatsapp_messages where id=$1", [job.id])).rows[0]).toEqual({ status: "failed", last_error: "delivery_unknown", attempts: 1 });
  });
  it("limits global claims to two even across independent consumers", async () => {
    const jobs = [];
    for (let i = 0; i < 3; i++) { const key = randomUUID(); await submit(client, key); jobs.push(await jobFor(key)); }
    expect((await claimJob(jobs[0].queue_id)).action).toBe("claimed");
    expect((await claimJob(jobs[1].queue_id)).action).toBe("claimed");
    expect((await claimJob(jobs[2].queue_id)).action).toBe("busy");
  });
  it("archives malformed poison jobs", async () => {
    const { rows } = await client.query("select pgmq.send('whatsapp_outbound', '{\"messageId\":\"bad\"}'::jsonb)::text as id");
    expect((await claimJob(rows[0].id)).action).toBe("skip");
  });
});

describe("concurrent submissions in independent transactions", () => {
  it("enforces two shared worker slots and finishes without a claim/finish deadlock", async () => {
    const keys = Array.from({ length: 3 }, () => randomUUID());
    const ips = keys.map(hash);
    try {
      for (let i = 0; i < keys.length; i++) {
        const connection = await pool.connect();
        try { await submit(connection, keys[i], true, ips[i]); } finally { connection.release(); }
      }
      const { rows: jobs } = await pool.query("select q.msg_id::text as queue_id, m.id from public.leads l join public.whatsapp_messages m on m.lead_id=l.id join pgmq.q_whatsapp_outbound q on q.message->>'messageId'=m.id::text where l.idempotency_key=any($1::uuid[])", [keys]);
      const claims = await Promise.all(jobs.map(async (job) => {
        const result = await pool.query("select public.claim_whatsapp_job($1,'welcome','es','v99.0') as result", [job.queue_id]);
        return { job, claim: result.rows[0].result };
      }));
      expect(claims.filter(({ claim }) => claim.action === "claimed")).toHaveLength(2);
      expect(claims.filter(({ claim }) => claim.action === "busy")).toHaveLength(1);
      const claimed = claims.find(({ claim }) => claim.action === "claimed")!;
      const results = await Promise.all([
        pool.query("select public.claim_whatsapp_job($1,'welcome','es','v99.0') as result", [claimed.job.queue_id]),
        pool.query("select public.finish_whatsapp_job($1,$2,$3,'sent','wamid.concurrent',null) as result", [claimed.job.queue_id, claimed.job.id, claimed.claim.claim_token]),
      ]);
      expect(["busy", "skip"]).toContain(results[0].rows[0].result.action);
      expect(results[1].rows[0].result).toBe(true);
    } finally {
      await pool.query("update private.whatsapp_worker_slots set message_id=null,claim_token=null,leased_until=null where message_id in (select m.id from public.whatsapp_messages m join public.leads l on l.id=m.lead_id where l.idempotency_key=any($1::uuid[]))", [keys]);
      for (const table of ["q_whatsapp_outbound", "a_whatsapp_outbound"]) {
        await pool.query(`delete from pgmq.${table} q using public.whatsapp_messages m,public.leads l where q.message->>'messageId'=m.id::text and m.lead_id=l.id and l.idempotency_key=any($1::uuid[])`, [keys]);
      }
      await pool.query("delete from public.whatsapp_messages m using public.leads l where m.lead_id=l.id and l.idempotency_key=any($1::uuid[])", [keys]);
      await pool.query("delete from public.leads where idempotency_key=any($1::uuid[])", [keys]);
      await pool.query("delete from private.lead_request_log where ip_hash=any($1::text[])", [ips]);
    }
  });
  it("allows five of ten simultaneous requests per IP", async () => {
    const ip = hash(); const keys = Array.from({ length: 10 }, () => randomUUID());
    try {
      const results = await Promise.all(keys.map(async (key) => {
        const connection = await pool.connect();
        try { return await submit(connection, key, false, ip); } finally { connection.release(); }
      }));
      expect(results.filter((result) => result.outcome === "created")).toHaveLength(5);
      expect(results.filter((result) => result.outcome === "rate_limited")).toHaveLength(5);
    } finally {
      await pool.query("delete from public.leads where idempotency_key=any($1::uuid[])", [keys]);
      await pool.query("delete from private.lead_request_log where ip_hash=$1", [ip]);
    }
  });
  it("creates one lead when the same key is submitted simultaneously", async () => {
    const key = randomUUID(); const ips = Array.from({ length: 8 }, hash);
    try {
      const results = await Promise.all(ips.map(async (ip) => {
        const connection = await pool.connect();
        try { return await submit(connection, key, false, ip); } finally { connection.release(); }
      }));
      expect(results.filter((result) => result.outcome === "created")).toHaveLength(1);
      expect(results.filter((result) => result.outcome === "replayed")).toHaveLength(7);
    } finally {
      await pool.query("delete from public.leads where idempotency_key=$1", [key]);
      await pool.query("delete from private.lead_request_log where ip_hash=any($1::text[])", [ips]);
    }
  });
});
