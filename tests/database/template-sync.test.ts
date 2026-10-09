import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import pg from "pg";

const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname)) throw new Error("Local DB only");

it("syncs the catalog under safeupdate without changing settings and rolls back invalid catalogs", async () => {
  // The local superuser can preload the same guard as PostgREST and seed fixtures.
  const connection = new URL(target);
  connection.username = "supabase_admin";
  const db = new pg.Client({ connectionString: connection.toString(), options: "-c session_preload_libraries=supautils,safeupdate" });
  await db.connect();
  try {
    await db.query("begin");
    const prefix = `sync_${randomUUID().replaceAll("-", "")}`;
    const kept = `${prefix}_kept`; const withdrawn = `${prefix}_withdrawn`; const added = `${prefix}_added`; const fixed = `${prefix}_fixed`;
    const pending = `${prefix}_pending`; const rejected = `${prefix}_rejected`; const incompatible = `${prefix}_incompatible`;
    const keptId = (await db.query("insert into public.whatsapp_templates(name,language,body,approved) values($1,'es','Hola {{1}}',true) returning id", [kept])).rows[0].id;
    await db.query("insert into public.whatsapp_templates(name,language,body,approved) values($1,'es','Hola {{1}}',true)", [withdrawn]);
    await db.query("update public.whatsapp_settings set template_id=$1 where singleton", [keptId]);
    const settings = (await db.query("select * from public.whatsapp_settings")).rows;
    await db.query("savepoint guard");
    await expect(db.query("update public.whatsapp_templates set approved=false")).rejects.toThrow("UPDATE requires a WHERE clause");
    await db.query("rollback to savepoint guard");
    await db.query("set local role service_role");
    await db.query("select public.sync_whatsapp_templates($1)", [JSON.stringify([
      { name: kept, language: "es", body: "Gracias {{1}}, recibimos tu solicitud." },
      { name: added, language: "es", body: "Bienvenido {{1}}" },
      { name: fixed, language: "es", body: "Gracias, recibimos tu solicitud.", meta_status: "APPROVED", approved: true, components: [{ type: "BODY", text: "Gracias, recibimos tu solicitud." }] },
      { name: pending, language: "es", body: "Hola {{1}} {{2}}", meta_status: "PENDING", approved: false },
      { name: rejected, language: "es", body: "", meta_status: "REJECTED", approved: false, components: [{ type: "HEADER", format: "IMAGE" }] },
      { name: incompatible, language: "es", body: "Hola", meta_status: "APPROVED", approved: false },
    ])]);
    expect((await db.query("select name,approved,body from public.whatsapp_templates where name=any($1) order by name", [[kept, withdrawn, added]])).rows).toEqual([
      { name: added, approved: true, body: "Bienvenido {{1}}" },
      { name: kept, approved: true, body: "Gracias {{1}}, recibimos tu solicitud." },
      { name: withdrawn, approved: false, body: "Hola {{1}}" },
    ]);
    expect((await db.query("select id from public.whatsapp_templates where name=$1", [kept])).rows[0].id).toBe(keptId);
    expect((await db.query("select approved,body from public.whatsapp_templates where name=$1", [fixed])).rows[0]).toEqual({ approved: true, body: "Gracias, recibimos tu solicitud." });
    expect((await db.query("select * from public.whatsapp_settings")).rows).toEqual(settings);
    expect((await db.query("select name,meta_status,approved from public.whatsapp_templates where name=any($1) order by name", [[pending, rejected, incompatible]])).rows).toEqual([
      { name: incompatible, meta_status: "APPROVED", approved: false },
      { name: pending, meta_status: "PENDING", approved: false },
      { name: rejected, meta_status: "REJECTED", approved: false },
    ]);
    expect((await db.query("select meta_status from public.whatsapp_templates where name=$1", [withdrawn])).rows[0].meta_status).toBe("UNAVAILABLE");
    expect((await db.query("select components from public.whatsapp_templates where name=$1", [rejected])).rows[0].components).toEqual([{ type: "HEADER", format: "IMAGE" }]);
    await db.query("savepoint invalid");
    await expect(db.query("select public.sync_whatsapp_templates($1)", [JSON.stringify([{ name: kept, language: "es", body: "Hola {{1}} {{2}}" }])])).rejects.toThrow(/check constraint/);
    await db.query("rollback to savepoint invalid");
    expect((await db.query("select approved,body from public.whatsapp_templates where name=$1", [kept])).rows[0]).toEqual({ approved: true, body: "Gracias {{1}}, recibimos tu solicitud." });
    await db.query("select public.sync_whatsapp_templates('[]'::jsonb)");
    expect((await db.query("select approved from public.whatsapp_templates where name=any($1)", [[kept, added]])).rows.every((row) => !row.approved)).toBe(true);
    expect((await db.query("select meta_status from public.whatsapp_templates where name=any($1)", [[kept, added, pending, rejected, incompatible]])).rows.every((row) => row.meta_status === "UNAVAILABLE")).toBe(true);
    expect((await db.query("select * from public.whatsapp_settings")).rows).toEqual(settings);
  } finally {
    await db.query("rollback"); await db.end();
  }
});
