import { execSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "@playwright/test";
import pg from "pg";

const status = JSON.parse(execSync("pnpm exec supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
if (!["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local Auth only");
const auth = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
const password = `Local-${randomBytes(18).toString("hex")}`;
const email = `admin-${randomUUID()}@example.com`;
const guestEmail = `guest-${randomUUID()}@example.com`;
let adminId: string; let guestId: string; let templateId: string; let leadId: string;
let original: { enabled: boolean; template_id: string | null; revision: number; updated_at: string; updated_by: string | null };
const fixtureName = `fixture_${randomUUID().replaceAll("-", "")}`;
const catalogIds: string[] = [];
test.beforeAll(async () => {
  await db.connect();
  original = (await db.query("select * from public.whatsapp_settings")).rows[0];
  const admin = await auth.auth.admin.createUser({ email, password, email_confirm: true });
  const guest = await auth.auth.admin.createUser({ email: guestEmail, password, email_confirm: true });
  if (admin.error || guest.error) throw new Error("Could not create local test accounts");
  adminId = admin.data.user.id; guestId = guest.data.user.id;
  await db.query("insert into public.admin_accounts(user_id) values($1)", [adminId]);
  templateId = (await db.query("insert into public.whatsapp_templates(name,language,body,approved) values($1,'es','Hola {{1}}, hemos recibido tu solicitud.',true) returning id", [fixtureName])).rows[0].id;
  for (const [suffix, metaStatus, body] of [["pending", "PENDING", "Pendiente {{1}}"], ["rejected", "REJECTED", "Rechazada {{1}}"], ["multiple", "APPROVED", "Hola {{1}} {{2}}"]]) {
    catalogIds.push((await db.query("insert into public.whatsapp_templates(name,language,body,approved,meta_status) values($1,'es',$2,false,$3) returning id", [`${fixtureName}_${suffix}`, body, metaStatus])).rows[0].id);
  }
  for (const [suffix, approved, url] of [["booking", true, "https://cal.com/example/reserva"], ["dynamic_booking", false, "https://cal.com/example/{{1}}"]] as const) {
    const components = [{ type: "BODY", text: "Puedes reservar aquí." }, { type: "BUTTONS", buttons: [{ type: "URL", text: "Reservar Sesión Gratuita", url }] }];
    catalogIds.push((await db.query("insert into public.whatsapp_templates(name,language,body,approved,meta_status,components,category) values($1,'es','Puedes reservar aquí.',$2,'APPROVED',$3,'MARKETING') returning id", [`${fixtureName}_${suffix}`, approved, JSON.stringify(components)])).rows[0].id);
  }
  await db.query("update public.whatsapp_settings set enabled=false, template_id=null where singleton");
  leadId = (await db.query("insert into public.leads(name,email,phone,utm_source,utm_campaign) values('Contacto de prueba',$1,'+34612345678','instagram','campana_de_prueba') returning id", [`contact-${adminId}@example.com`])).rows[0].id;
});
test.afterAll(async () => {
  await db.query("update public.whatsapp_settings set enabled=$1,template_id=$2,revision=$3,updated_at=$4,updated_by=$5 where singleton", [original.enabled, original.template_id, original.revision, original.updated_at, original.updated_by]);
  await db.query("delete from public.admin_audit where actor_id=$1", [adminId]);
  await db.query("delete from public.whatsapp_templates where id=$1", [templateId]);
  await db.query("delete from public.whatsapp_templates where id=any($1)", [catalogIds]);
  await db.query("delete from public.leads where id=$1", [leadId]);
  if (adminId) await auth.auth.admin.deleteUser(adminId);
  if (guestId) await auth.auth.admin.deleteUser(guestId);
  await db.end();
});
async function login(page: Page, account = email, pass = password) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(account);
  await page.getByLabel("Contraseña", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

test("template sync invokes the function without saving settings, and rejects anonymous action replay", async ({ page, request }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await page.goto("/admin/whatsapp");
  const before = (await db.query("select enabled,template_id,revision from public.whatsapp_settings")).rows[0];
  const catalog = (await db.query("select * from public.whatsapp_templates where id=any($1) order by id", [[templateId, ...catalogIds]])).rows;
  const submitted = page.waitForRequest((req) => req.method() === "POST" && !!req.headers()["next-action"]);
  await page.getByRole("button", { name: "Sincronizar con Meta", exact: true }).click();
  const actionRequest = await submitted;
  // Local tests have no Meta credentials; the failure must be visible and leave the catalog intact.
  await expect(page.locator(".admin-whatsapp-settings [role=status]")).toContainText(/no está configurada|No se pudo/, { timeout: 60000 });
  await expect(page.getByRole("button", { name: "Sincronizar con Meta", exact: true })).toBeEnabled();
  expect((await db.query("select enabled,template_id,revision from public.whatsapp_settings")).rows[0]).toEqual(before);
  expect((await db.query("select * from public.whatsapp_templates where id=any($1) order by id", [[templateId, ...catalogIds]])).rows).toEqual(catalog);
  const unauthorized = await request.post("/admin/whatsapp", { headers: { "next-action": actionRequest.headers()["next-action"], "content-type": actionRequest.headers()["content-type"], origin: new URL(page.url()).origin }, data: actionRequest.postData()!, maxRedirects: 0 });
  expect(unauthorized.headers()["x-action-redirect"]).toContain("/admin/login");
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByRole("button", { name: "Sincronizar con Meta", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: "test-results/whatsapp-sync-mobile.png", fullPage: true });
});
test("guards pages, rejects non-admin users and invalid credentials, and revokes active sessions", async ({ page }) => {
  const publicAuth = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const registration = await publicAuth.auth.signUp({ email: `blocked-${randomUUID()}@example.com`, password });
  expect(registration.error?.code).toBe("signup_disabled");
  await page.goto("/admin/contacts"); await expect(page).toHaveURL(/\/admin\/login$/);
  await login(page, guestEmail); await expect(page.getByRole("status")).toContainText("No se pudo acceder");
  await login(page, email, "incorrect-password"); await expect(page.getByRole("status")).toContainText("No se pudo acceder");
  await login(page); await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => cookie.name.startsWith("sb-") && cookie.httpOnly && cookie.path === "/admin" && cookie.sameSite === "Lax")).toBe(true);
  const response = await page.goto("/admin/contacts");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  await db.query("update public.admin_accounts set active=false where user_id=$1", [adminId]);
  await page.goto("/admin/whatsapp"); await expect(page).toHaveURL(/denied=1/);
  await db.query("update public.admin_accounts set active=true where user_id=$1", [adminId]);
});
test("shows real reports, contacts, fixed WhatsApp messages and responsive account settings", async ({ page }) => {
  await login(page); await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await expect(page.getByText("Vercel Analytics", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByRole("complementary").getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary").getByRole("link", { name: `Mi cuenta: ${email}`, exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administración" }).getByRole("link", { name: "Resumen", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Ir al contenido" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#admin-content")).toBeFocused();
  await expect(page.locator(".admin-campaigns")).toContainText("campana_de_prueba");
  await expect(page.locator('[aria-label="Gráfica diaria de solicitudes y correos únicos"] svg.recharts-surface')).toBeVisible();
  await expect(page.locator(".admin-campaigns li").filter({ hasText: "campana_de_prueba" })).toContainText("1 correos únicos");
  await expect(page.locator(".admin-summary [data-slot=card]")).toHaveCount(0);
  await page.getByRole("heading", { name: "Resumen", exact: true }).hover();
  await page.getByText("Ver datos diarios", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Solicitudes por día" }).locator("details")).toContainText("1 solicitudes · 1 correos únicos");
  await page.getByText("Ver datos diarios", { exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/admin-summary-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  const chartBounds = await page.locator(".admin-summary .admin-chart").boundingBox();
  expect(chartBounds!.height).toBeGreaterThanOrEqual(208);
  const trafficBounds = await page.getByRole("region", { name: "Tráfico de la web" }).boundingBox();
  expect(trafficBounds!.y + trafficBounds!.height).toBeLessThan(720);
  expect(trafficBounds!.y + trafficBounds!.height).toBeLessThan(chartBounds!.y);
  await page.setViewportSize({ width: 1920, height: 900 });
  const wideChart = await page.locator(".admin-summary .admin-chart").boundingBox();
  expect(wideChart!.height).toBeGreaterThanOrEqual(400);
  expect(wideChart!.width).toBeGreaterThan(1000);
  const wideTraffic = await page.getByRole("region", { name: "Tráfico de la web" }).boundingBox();
  expect(wideTraffic!.y + wideTraffic!.height).toBeLessThan(900);
  await page.screenshot({ path: "test-results/admin-summary-wide.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("navigation", { name: "Períodos rápidos" }).getByRole("link", { name: "7 días", exact: true }).click();
  await expect(page.getByRole("link", { name: "7 días", exact: true })).toHaveAttribute("aria-current", "true");
  const sevenDays = new URL(page.url()).searchParams;
  expect((Date.parse(sevenDays.get("end")!) - Date.parse(sevenDays.get("start")!)) / 86400000).toBe(7);
  await page.getByRole("button", { name: "Cambiar período" }).click();
  const period = page.getByRole("dialog", { name: "Seleccionar período" });
  await expect(period).toBeVisible();
  await period.getByLabel("Desde", { exact: true }).fill("2026-09-10");
  await period.getByLabel("Hasta", { exact: true }).fill("2026-09-09");
  await period.getByRole("button", { name: "Aplicar período" }).click();
  await expect(period.getByRole("alert")).toContainText("entre 1 y 366 días");
  await period.getByLabel("Hasta", { exact: true }).fill("2026-09-10");
  await period.getByRole("button", { name: "Aplicar período" }).click();
  await expect(page).toHaveURL(/start=2026-09-10&end=2026-09-11/);
  await expect(page.getByRole("button", { name: "Cambiar período" })).toContainText("10 sept");
  await page.getByRole("link", { name: "90 días", exact: true }).click();
  await expect(page.getByRole("link", { name: "90 días", exact: true })).toHaveAttribute("aria-current", "true");
  await page.getByRole("link", { name: "30 días", exact: true }).click();
  await expect(page.getByRole("link", { name: "30 días", exact: true })).toHaveAttribute("aria-current", "true");
  await page.getByRole("link", { name: "Contactos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Contactos", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `contact-${adminId}@example.com`, exact: true })).toBeVisible();
  await page.getByLabel("Buscar email", { exact: true }).fill(`contact-${adminId}@example.com`);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.locator(".admin-result-count")).toContainText("1 solicitud que coincide");
  await page.getByRole("link", { name: "7 días", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/contacts\?/);
  await expect(page.getByLabel("Buscar email", { exact: true })).toHaveValue(`contact-${adminId}@example.com`);
  await expect(page.getByRole("link", { name: `contact-${adminId}@example.com`, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Limpiar búsqueda", exact: true }).click();
  await expect(page.getByLabel("Buscar email", { exact: true })).toHaveValue("");
  await page.screenshot({ path: "test-results/admin-contacts-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "WhatsApp", exact: true }).click();
  await expect(page.locator(".admin-template-card")).toHaveCount(8);
  await expect(page.locator('[data-automation="booking_confirmation"]')).toContainText("La idea de la llamada es:");
  await expect(page.getByRole("button", { name: "Usar para bienvenida", exact: true })).toHaveCount(0);
  await expect(page.locator(".admin-message-stats")).not.toBeVisible();
  await page.screenshot({ path: "test-results/admin-whatsapp-desktop.png", fullPage: true });
  await page.goto("/admin/account");
  await expect(page.getByRole("heading", { name: "Cambiar contraseña", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-account-desktop.png", fullPage: true });
  for (const width of [768, 320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/admin", "/admin/contacts", "/admin/calls", "/admin/whatsapp", "/admin/account"]) {
      await page.goto(path); const navigation = page.getByRole("navigation", { name: "Administración" });
      await expect(navigation).toBeVisible();
      await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute("href", path);
      const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      expect(dimensions.content, `${width}px ${path}`).toBeLessThanOrEqual(dimensions.viewport);
      if (path === "/admin" || path === "/admin/contacts") {
        await page.getByRole("button", { name: "Cambiar período" }).click();
        const popover = page.getByRole("dialog", { name: "Seleccionar período" });
        await expect(popover).toBeVisible();
        const bounds = await popover.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
        await expect(popover).not.toBeVisible();
        await expect(page.getByRole("button", { name: "Cambiar período" })).toBeFocused();
      }
      if (width === 390 && path === "/admin") await page.screenshot({ path: "test-results/admin-summary-mobile.png", fullPage: true });
      if (width === 390 && path === "/admin/contacts") await page.screenshot({ path: "test-results/admin-contacts-mobile.png", fullPage: true });
      if (width === 390 && path === "/admin/whatsapp") await page.screenshot({ path: "test-results/admin-whatsapp-mobile.png", fullPage: true });
      if (path === "/admin/whatsapp") {
        await expect(page.locator(".admin-template-card")).toHaveCount(8);
        await expect(page.getByRole("link", { name: "Gestionar en Meta" })).toBeVisible();
      }
      if (width === 390 && path === "/admin/account") await page.screenshot({ path: "test-results/admin-account-mobile.png", fullPage: true });
    }
  }
  const changedPassword = `Changed-${randomBytes(18).toString("hex")}`;
  await page.getByLabel("Contraseña actual", { exact: true }).fill(password);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(changedPassword);
  await page.getByLabel("Repetir contraseña", { exact: true }).fill(changedPassword);
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page.getByRole("status")).toContainText("Contraseña actualizada");
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin"); await expect(page).toHaveURL(/\/admin\/login$/);
});
test("admin typography keeps summary and contact rows readable across viewport sizes", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/admin", "/admin/contacts"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: path === "/admin" ? "Resumen" : "Contactos", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (path === "/admin/contacts") {
        const row = page.getByRole("row").filter({ hasText: `contact-${adminId}@example.com` });
        await expect(row).toBeVisible();
        expect(await row.getByRole("cell").first().evaluate(element => getComputedStyle(element).fontSize)).toBe("15px");
        await expect(row.getByRole("link", { name: `contact-${adminId}@example.com`, exact: true })).toBeVisible();
      }
      await page.screenshot({ path: `test-results/admin-type-${path === "/admin" ? "summary" : "contacts"}-${width}.png`, fullPage: true });
    }
  }
});

test("a private invitation sets a password without consuming the link on GET, then supports recovery", async ({ page }) => {
  const newEmail = `invite-${randomUUID()}@example.com`;
  const created = await auth.auth.admin.generateLink({ type: "invite", email: newEmail });
  if (created.error) throw new Error("Could not create local invite");
  const userId = created.data.user.id;
  await db.query("insert into public.admin_accounts(user_id) values($1)", [userId]);
  const newPassword = `Invite-${randomBytes(18).toString("hex")}`;
  try {
    const link = `/admin/accept?type=invite&token_hash=${created.data.properties.hashed_token}`;
    await page.goto(link); await page.reload();
    await page.getByLabel("Nueva contraseña", { exact: true }).fill(newPassword);
    await page.getByLabel("Repetir contraseña", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Establecer contraseña" }).click();
    await expect(page).toHaveURL(/ready=1/);
    await login(page, newEmail, newPassword); await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    await page.goto(link);
    await page.getByLabel("Nueva contraseña", { exact: true }).fill(newPassword);
    await page.getByLabel("Repetir contraseña", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Establecer contraseña" }).click();
    await expect(page.getByRole("status")).toContainText("ha caducado o ya se ha usado");
    const recovery = await auth.auth.admin.generateLink({ type: "recovery", email: newEmail });
    if (recovery.error) throw new Error("Could not create local recovery");
    const recoveredPassword = `Recover-${randomBytes(18).toString("hex")}`;
    await page.goto(`/admin/accept?type=recovery&token_hash=${recovery.data.properties.hashed_token}`);
    await page.getByLabel("Nueva contraseña", { exact: true }).fill(recoveredPassword);
    await page.getByLabel("Repetir contraseña", { exact: true }).fill(recoveredPassword);
    await page.getByRole("button", { name: "Establecer contraseña" }).click();
    await expect(page).toHaveURL(/ready=1/);
    await login(page, newEmail, recoveredPassword); await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  } finally { await auth.auth.admin.deleteUser(userId); }
});
