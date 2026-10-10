import { execSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { test, expect } from "@playwright/test";
import pg from "pg";
import { whatsappAutomations } from "../../lib/followups/whatsapp-automations";

const status = JSON.parse(execSync("pnpm exec supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
if (!["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local Auth only");
const auth = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
const email = `whatsapp-${randomUUID()}@example.com`;
const password = `Local-${randomBytes(18).toString("hex")}`;
const prefix = `fixture_${randomUUID().replaceAll("-", "")}`;
let adminId: string;
let original: { enabled: boolean; template_id: string | null; revision: number; updated_at: string; updated_by: string | null };
let bindings: { step: string; name: string; language: string; approved: boolean; verified_at: string }[] = [];
const statuses = ["APPROVED", "PENDING", "REJECTED", "APPROVED", "APPROVED", "PENDING", "PAUSED", "APPROVED"];

test.beforeAll(async () => {
  await db.connect();
  original = (await db.query("select * from public.whatsapp_settings")).rows[0];
  bindings = (await db.query("select * from private.followup_templates")).rows;
  const result = await auth.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error) throw result.error;
  adminId = result.data.user.id;
  await db.query("insert into public.admin_accounts(user_id) values($1)", [adminId]);
  await db.query("delete from private.followup_templates");
  for (const [index, definition] of whatsappAutomations.entries()) {
    const step = (await db.query("select body,parameter from public.followup_steps where key=$1", [definition.key])).rows[0];
    const body = index === 0 ? "Contenido real del catálogo de Meta, distinto de la copia interna." : step.parameter ? step.body.replace(`{{${step.parameter}}}`, "{{1}}") : step.body;
    const name = `${prefix}_${definition.key}`;
    const components = [
      ...(index === 0 ? [{ type: "HEADER", format: "IMAGE", example: { header_handle: ["http://127.0.0.1:3100/next.svg"] } }] : []),
      { type: "BODY", text: body },
      ...(index === 6 ? [{ type: "BUTTONS", buttons: [{ type: "URL", text: "Reservar sesión", url: "https://example.com/book" }] }] : []),
    ];
    await db.query("insert into public.whatsapp_templates(name,language,body,approved,meta_status,category,components) values($1,'es',$2,$3,$4,'MARKETING',$5)", [name, body, statuses[index] === "APPROVED", statuses[index], JSON.stringify(components)]);
    await db.query("insert into private.followup_templates(step,name,language,approved) values($1,$2,'es',$3)", [definition.key, name, statuses[index] === "APPROVED"]);
  }
});

test.afterAll(async () => {
  if (original) await db.query("update public.whatsapp_settings set enabled=$1,template_id=$2,revision=$3,updated_at=$4,updated_by=$5 where singleton", [original.enabled, original.template_id, original.revision, original.updated_at, original.updated_by]);
  await db.query("delete from private.followup_templates");
  for (const binding of bindings) await db.query("insert into private.followup_templates(step,name,language,approved,verified_at) values($1,$2,$3,$4,$5)", [binding.step, binding.name, binding.language, binding.approved, binding.verified_at]);
  await db.query("delete from public.whatsapp_templates where name like $1", [`${prefix}%`]);
  if (adminId) {
    await db.query("delete from public.admin_audit where actor_id=$1", [adminId]);
    await auth.auth.admin.deleteUser(adminId);
  }
  await db.end();
});

test.beforeEach(async ({ page }) => {
  await db.query("update public.whatsapp_settings set enabled=false,template_id=null,revision=revision+1 where singleton");
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/whatsapp");
});

test("shows eight fixed triggers and Meta statuses with no template selection or editing", async ({ page }) => {
  const before = (await db.query("select * from public.whatsapp_settings")).rows[0];
  await expect(page.locator(".admin-template-card")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Sincronizar con Meta", exact: true })).toBeVisible();
  const templates = page.locator(".admin-whatsapp-templates");
  await expect(templates).not.toHaveAttribute("open");
  await expect(page.locator(".admin-template-card").first()).toBeHidden();
  await templates.locator("summary").click();
  await expect(templates).toHaveAttribute("open");
  await expect(page.locator(".admin-template-card").first()).toBeVisible();
  await expect(page.locator(".admin-template-card form, .admin-template-card button, .admin-whatsapp-settings input, .admin-whatsapp-settings select, .admin-whatsapp-settings textarea")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guardar plantilla" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Usar para bienvenida" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Crear nueva versión" })).toHaveCount(0);
  await expect(page.locator('[data-automation="booking_confirmation"]')).toContainText("Aprobada");
  await expect(page.locator('[data-automation="booking_confirmation"]')).toContainText("Contenido real del catálogo de Meta");
  await expect(page.getByRole("img", { name: "Imagen de Confirmación de reserva" })).toBeVisible();
  await expect(page.locator('[data-automation="webinar_1d"]')).toContainText("Botón: Reservar sesión");
  await expect(page.locator('[data-automation="booking_short_notice"]')).toContainText("Pendiente de aprobación");
  await expect(page.locator('[data-automation="booking_24h"]')).toContainText("Rechazada");
  await expect(page.locator('[data-automation="webinar_1d"]')).toContainText("Pausada");
  await expect(page.locator('[data-automation="webinar_1h"]')).toContainText("[Nombre del registro]");
  await expect(page.locator('[data-automation="booking_2h"]')).toContainText("[Enlace de Meet]");
  await expect(page.getByText("El administrador revisa las respuestas ambiguas y gestiona las cancelaciones en Cal.com.", { exact: false })).toBeVisible();
  const meta = page.getByRole("link", { name: "Consultar en Meta" });
  const url = new URL((await meta.getAttribute("href"))!);
  expect(url.hostname).toBe("business.facebook.com");
  expect(url.searchParams.get("business_id")).toBe("1102523378841182");
  expect(url.searchParams.get("asset_id")).toBe("1407248797600706");
  await expect(meta).toHaveAttribute("target", "_blank");
  await expect(meta).toHaveAttribute("rel", "noopener noreferrer");
  for (const [width, columns] of [[1440, 4], [1280, 4], [768, 2], [390, 1], [320, 1]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const grid of await page.locator(".admin-template-grid").all()) {
      expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(columns);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.vercel/whatsapp-fixed-automations-${width}.png`, fullPage: true });
  }
  await templates.locator("summary").click();
  await expect(page.locator(".admin-template-card").first()).toBeHidden();
  await expect(page.getByRole("button", { name: "Sincronizar con Meta", exact: true })).toBeVisible();
  expect((await db.query("select * from public.whatsapp_settings")).rows[0]).toEqual(before);
});
