import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import pg from "pg";
const status = JSON.parse(execSync("pnpm exec supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
if (!["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local Auth only");
const auth = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
const email = `versions-${randomUUID()}@example.com`; const password = `Local-${randomBytes(18).toString("hex")}`;
const name = `version_${randomUUID().replaceAll("-", "")}_v1`;
let userId: string; let templateId: string; let original: Record<string, unknown>;
test.beforeAll(async () => {
  await db.connect(); original = (await db.query("select * from public.whatsapp_settings")).rows[0];
  const user = await auth.auth.admin.createUser({ email, password, email_confirm: true }); if (user.error) throw user.error;
  userId = user.data.user.id; await db.query("insert into public.admin_accounts(user_id) values($1)", [userId]);
  templateId = (await db.query("insert into public.whatsapp_templates(name,language,body,approved,category,components) values($1,'es','Hola {{1}}, bienvenida.',true,'UTILITY',$2) returning id", [name, JSON.stringify([{ type: "BODY", text: "Hola {{1}}, bienvenida." }])])).rows[0].id;
  await db.query("update public.whatsapp_settings set template_id=$1,enabled=true where singleton", [templateId]);
});
test.afterAll(async () => {
  if (original) await db.query("update public.whatsapp_settings set enabled=$1,template_id=$2,revision=$3,updated_at=$4,updated_by=$5 where singleton", [original.enabled, original.template_id, original.revision, original.updated_at, original.updated_by]);
  if (templateId) await db.query("delete from public.whatsapp_templates where id=$1", [templateId]);
  if (userId) await auth.auth.admin.deleteUser(userId);
  await db.end();
});
test("template management opens Meta without editing the active original in the panel", async ({ page }) => {
  await page.goto("/admin/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click(); await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await page.goto("/admin/whatsapp");
  const settings = (await db.query("select * from public.whatsapp_settings")).rows[0];
  await expect(page.locator(".admin-template-card")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Crear nueva versión" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Consultar en Meta" })).toHaveAttribute("href", /business\.facebook\.com\/latest\/whatsapp_manager\/message_templates/);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByRole("link", { name: "Consultar en Meta" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect((await db.query("select * from public.whatsapp_settings")).rows[0]).toEqual(settings);
});
