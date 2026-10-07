import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import pg from "pg";
const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname)) throw new Error("Local DB only");
const pool = new pg.Pool({ connectionString: target });
let db: pg.PoolClient; let actor: string; let templateId: string;
beforeEach(async () => {
  db = await pool.connect(); await db.query("begin"); actor = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,$2)", [actor, `${actor}@example.com`]);
  await db.query("insert into public.admin_accounts(user_id) values($1)", [actor]);
  templateId = (await db.query("insert into public.whatsapp_templates(name,language,body,approved) values($1,'es','Hola {{1}}',true) returning id", [`test_${actor.replaceAll("-", "")}`])).rows[0].id;
  await db.query("update public.whatsapp_settings set enabled=false,template_id=null,revision=0 where singleton");
});
afterEach(async () => { await db.query("rollback"); db.release(); });
afterAll(async () => { await pool.end(); });
async function save(revision = 0, enabled = true, template = templateId) { return (await db.query("select public.set_whatsapp_settings($1,$2,$3,$4) as result", [actor, revision, enabled, template])).rows[0].result; }
async function job() {
  const key = randomUUID();
  await db.query("select public.submit_lead($1,'Prueba','+34612345678','admin_test@example.com',true,'v1',$2)", [key, createHash("sha256").update(key).digest("hex")]);
  return (await db.query("select q.msg_id::text as queue_id,m.id from public.leads l join public.whatsapp_messages m on m.lead_id=l.id join pgmq.q_whatsapp_outbound q on q.message->>'messageId'=m.id::text where l.idempotency_key=$1", [key])).rows[0];
}
async function claim(queue: string) { return (await db.query("select public.claim_configured_whatsapp_job($1,'v99.0') as result", [queue])).rows[0].result; }
describe("admin protection and settings", () => {
  it.each(["anon", "authenticated"])("denies all admin tables and privileged functions to %s", async (role) => {
    for (const sql of ["select * from public.admin_accounts", "select * from public.whatsapp_settings", "select * from public.whatsapp_templates", "select * from public.admin_audit", "select public.allow_admin_login(repeat('a',64))", "select public.claim_configured_whatsapp_job(0,'v99.0')", "select public.set_whatsapp_settings(null,0,false,null)", "select public.sync_whatsapp_templates('[]')"]) {
      await db.query("savepoint denied"); await db.query(`set local role ${role}`);
      await expect(db.query(sql)).rejects.toThrow(/permission denied/); await db.query("rollback to savepoint denied");
    }
  });
  it("saves atomically, audits the actor and rejects stale revisions", async () => {
    expect(await save()).toEqual({ outcome: "saved" });
    expect(await save()).toEqual({ outcome: "conflict" });
    expect((await db.query("select revision,enabled from public.whatsapp_settings")).rows[0]).toMatchObject({ revision: 1, enabled: true });
    expect((await db.query("select actor_id,details from public.admin_audit where actor_id=$1", [actor])).rows).toHaveLength(1);
    expect((await db.query("select actor_email from public.admin_audit where actor_id=$1", [actor])).rows[0].actor_email).toBe(`${actor}@example.com`);
  });
  it("rejects revoked administrators even with a valid user UUID", async () => {
    await db.query("update public.admin_accounts set active=false where user_id=$1", [actor]);
    await expect(save()).rejects.toThrow("Administrator required");
  });
  it("rejects a non-approved template without changing settings or audit", async () => {
    await db.query("update public.whatsapp_templates set approved=false where id=$1", [templateId]);
    await db.query("savepoint rejected"); await expect(save()).rejects.toThrow("Approved template required"); await db.query("rollback to savepoint rejected");
    expect((await db.query("select revision from public.whatsapp_settings")).rows[0].revision).toBe(0);
    expect((await db.query("select count(*)::int as n from public.admin_audit where actor_id=$1", [actor])).rows[0].n).toBe(0);
  });
  it("uses a shared rolling login limit", async () => {
    const hash = createHash("sha256").update(actor).digest("hex");
    for (let i=0;i<10;i++) expect((await db.query("select public.allow_admin_login($1) as allowed", [hash])).rows[0].allowed).toBe(true);
    expect((await db.query("select public.allow_admin_login($1) as allowed", [hash])).rows[0].allowed).toBe(false);
    await db.query("update private.admin_login_log set created_at=now()-interval '11 minutes' where ip_hash=$1", [hash]);
    expect((await db.query("select public.allow_admin_login($1) as allowed", [hash])).rows[0].allowed).toBe(true);
  });
});
describe("worker consumes dashboard configuration", () => {
  it("pauses without consuming attempts; enabled settings snapshot the approved template", async () => {
    const queued = await job(); expect(await claim(queued.queue_id)).toEqual({ action: "paused" });
    expect((await db.query("select status,attempts from public.whatsapp_messages where id=$1", [queued.id])).rows[0]).toEqual({ status: "pending", attempts: 0 });
    await save(); expect(await claim(queued.queue_id)).toMatchObject({ action: "claimed", template_language: "es", graph_api_version: "v99.0" });
  });
  it("keeps the first template on retry after an administrator changes selection", async () => {
    const queued = await job(); await save(); const first = await claim(queued.queue_id);
    await db.query("select public.finish_whatsapp_job($1,$2,$3,'retry',null,'meta_130429')", [queued.queue_id, queued.id, first.claim_token]);
    const other = (await db.query("insert into public.whatsapp_templates(name,language,body,approved) values($1,'en','Hello {{1}}',true) returning id", [`other_${actor.replaceAll("-", "")}`])).rows[0].id;
    await save(1,true,other); await db.query("update public.whatsapp_messages set scheduled_at=now()-interval '1 second' where id=$1", [queued.id]);
    expect(await claim(queued.queue_id)).toMatchObject({ action: "claimed", template_name: first.template_name, template_language: "es" });
  });
  it("cleans up interrupted processing and duplicate final jobs even while paused", async () => {
    const queued = await job(); await save(); await claim(queued.queue_id); await save(1,false);
    await db.query("update public.whatsapp_messages set processing_started_at=now()-interval '121 seconds' where id=$1", [queued.id]);
    expect(await claim(queued.queue_id)).toEqual({ action: "unknown" });
    expect((await db.query("select status,last_error from public.whatsapp_messages where id=$1", [queued.id])).rows[0]).toEqual({ status: "failed", last_error: "delivery_unknown" });
    expect((await db.query("select count(*)::int as n from pgmq.q_whatsapp_outbound where msg_id=$1", [queued.queue_id])).rows[0].n).toBe(0);
  });
  it("does not send a template withdrawn from the catalog", async () => {
    const queued = await job(); await save(); await db.query("update public.whatsapp_templates set approved=false where id=$1", [templateId]);
    expect(await claim(queued.queue_id)).toEqual({ action: "paused" });
  });
  it("rolls back a catalog refresh entirely when a template is invalid", async () => {
    await db.query("savepoint catalog");
    await expect(db.query("select public.sync_whatsapp_templates($1)", [JSON.stringify([{ name: "invalid", language: "es", body: "Hola {{1}} {{2}}" }])])).rejects.toThrow(/check constraint/);
    await db.query("rollback to savepoint catalog");
    expect((await db.query("select approved from public.whatsapp_templates where id=$1", [templateId])).rows[0].approved).toBe(true);
  });
});
