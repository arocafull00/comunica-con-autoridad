import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import pg from "pg";
const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname)) throw new Error("Local DB only");
it("keeps the original active while a new version waits for approval, then preserves lineage when synchronized", async () => {
  const db = new pg.Client({ connectionString: target }); await db.connect();
  try {
    await db.query("begin");
    const actor = randomUUID(); const base = `version_${actor.replaceAll("-", "")}`;
    await db.query("insert into auth.users(id,email) values($1,$2)", [actor, `${actor}@example.com`]);
    await db.query("insert into public.admin_accounts(user_id) values($1)", [actor]);
    const original = (await db.query("insert into public.whatsapp_templates(name,language,body,approved,category,meta_id) values($1,'es','Hola {{1}}',true,'UTILITY','111') returning id", [`${base}_v1`])).rows[0].id;
    await db.query("update public.whatsapp_settings set enabled=true,template_id=$1 where singleton", [original]);
    const settings = (await db.query("select * from public.whatsapp_settings")).rows[0];
    const version = (await db.query("insert into public.whatsapp_templates(name,language,body,approved,category,meta_id,meta_status,version_of) values($1,'es','Gracias {{1}}',false,'UTILITY','222','PENDING',$2) returning id", [`${base}_v2`, original])).rows[0].id;
    expect((await db.query("select approved from public.whatsapp_templates where id=$1", [original])).rows[0].approved).toBe(true);
    expect((await db.query("select * from public.whatsapp_settings")).rows[0]).toEqual(settings);
    await db.query("savepoint not_approved");
    await expect(db.query("select public.set_whatsapp_settings($1,$2,true,$3)", [actor, settings.revision, version])).rejects.toThrow("Approved template required");
    await db.query("rollback to savepoint not_approved");
    await db.query("select public.sync_whatsapp_templates($1)", [JSON.stringify([
      { name: `${base}_v1`, language: "es", body: "Hola {{1}}", approved: true, meta_status: "APPROVED", category: "UTILITY", meta_id: "111" },
      { name: `${base}_v2`, language: "es", body: "Gracias {{1}}", approved: true, meta_status: "APPROVED", category: "UTILITY", meta_id: "222" },
    ])]);
    expect((await db.query("select id,version_of,category,meta_id from public.whatsapp_templates where id=$1", [version])).rows[0]).toEqual({ id: version, version_of: original, category: "UTILITY", meta_id: "222" });
    expect((await db.query("select * from public.whatsapp_settings")).rows[0]).toEqual(settings);
    expect((await db.query("select public.set_whatsapp_settings($1,$2,true,$3) as result", [actor, settings.revision, version])).rows[0].result).toEqual({ outcome: "saved" });
    expect((await db.query("select template_id,enabled from public.whatsapp_settings")).rows[0]).toEqual({ template_id: version, enabled: true });
  } finally { await db.query("rollback"); await db.end(); }
});
