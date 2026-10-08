import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import pg from "pg";

const status = JSON.parse(execSync("pnpm exec supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
if (!["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local Auth only");
const auth = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
const fixture = randomUUID();
const email = `summary-${fixture}@example.com`;
const password = `Local-${randomBytes(18).toString("hex")}`;
let adminId: string;

test.beforeAll(async () => {
  await db.connect();
  const result = await auth.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error) throw result.error;
  adminId = result.data.user.id;
  await db.query("insert into public.admin_accounts(user_id) values($1)", [adminId]);
  for (const [suffix, day] of [["a", "2026-05-27"], ["b", "2026-05-30"], ["a", "2026-06-02"], ["b", "2026-06-02"], ["c", "2026-06-02"], ["c", "2026-06-02"]]) {
    await db.query("insert into public.leads(name,email,phone,created_at,utm_campaign) values('Resumen de prueba',$1,'+34612345678',$2,$3)", [`${fixture}-${suffix}@example.com`, `${day}T10:00:00+02:00`, fixture]);
  }
});
test.afterAll(async () => {
  await db.query("delete from public.leads where utm_campaign=$1", [fixture]);
  if (adminId) await auth.auth.admin.deleteUser(adminId);
  await db.end();
});

test("summary hierarchy, real equal-period comparisons and keyboard toggle fit desktop and mobile", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await page.goto("/admin?start=2026-06-01&end=2026-06-08");
  const emails = page.locator(".admin-bento-emails");
  const toggle = emails.getByRole("button");
  await expect(emails.locator("dd").first()).toHaveText("3");
  await expect(toggle).toContainText("+50 %");
  await expect(emails).toContainText("vs. 7 días anteriores");
  await expect(toggle.locator("svg")).toHaveClass(/lucide-trending-up/);
  await expect(toggle).toHaveCSS("color", "rgb(131, 217, 163)");
  await expect(toggle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toContainText("+1");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(toggle).toContainText("+50 %");
  await expect(page.locator(".admin-bento-requests dd").first()).toHaveText("4");
  await expect(page.locator(".admin-bento-requests button")).toContainText("+100 %");
  await expect(page.locator(".admin-bento-consents button")).toContainText("0 %");
  await expect(page.locator(".admin-bento-conversion")).toContainText("Comparación no disponible");
  const traffic = await page.getByRole("region", { name: "Tráfico de la web" }).boundingBox();
  const chart = await page.getByRole("region", { name: "Solicitudes por día" }).boundingBox();
  expect(traffic!.y + traffic!.height).toBeLessThan(chart!.y);
  const sizes = await page.evaluate(() => [".admin-bento-emails > dd", ".admin-bento-requests > dd", ".admin-bento-consents > dd"].map((selector) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize)));
  expect(sizes[0]).toBeGreaterThan(sizes[1]);
  expect(sizes[1]).toBeGreaterThan(sizes[2]);
  await page.screenshot({ path: "test-results/summary-bento-desktop.png", fullPage: true });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(toggle).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/summary-bento-${width}.png`, fullPage: true });
  }
  await toggle.click();
  await expect(toggle).toContainText("+1");
  await page.getByRole("button", { name: "Cambiar período" }).click();
  const period = page.getByRole("dialog", { name: "Seleccionar período" });
  await period.getByLabel("Desde", { exact: true }).fill("2026-06-01");
  await period.getByLabel("Hasta", { exact: true }).fill("2026-06-30");
  await period.getByRole("button", { name: "Aplicar período" }).click();
  await expect(page).toHaveURL(/start=2026-06-01&end=2026-07-01/);
  await expect(emails).toContainText("vs. 30 días anteriores");
  await expect(toggle).toContainText("+50 %");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.goto("/admin?start=2026-06-02&end=2026-06-03");
  await expect(emails).toContainText("vs. 1 día anterior");
  await expect(toggle).toContainText("Sin base previa");
  await toggle.click();
  await expect(toggle).toContainText("+3");
  await page.goto("/admin?start=2026-06-03&end=2026-06-04");
  await expect(toggle).toContainText("-100 %");
  await expect(toggle.locator("svg")).toHaveClass(/lucide-trending-down/);
  await toggle.click();
  await expect(toggle).toContainText("-3");
});
