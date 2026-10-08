import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { test, expect } from "@playwright/test";
import pg from "pg";

const status = JSON.parse(execSync("pnpm exec supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
if (!["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local Auth only");
const auth = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
const email = `navigation-${randomUUID()}@example.com`;
const password = `Local-${randomBytes(18).toString("hex")}`;
let userId: string;
let leadId: string;

test.beforeAll(async () => {
  await db.connect();
  const created = await auth.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  await db.query("insert into public.admin_accounts(user_id) values($1)", [userId]);
});
test.afterAll(async () => {
  if (leadId) await db.query("delete from public.leads where id=$1", [leadId]);
  if (userId) await auth.auth.admin.deleteUser(userId);
  await db.end();
});

test("prefetches private screens, reuses them without waiting for the server, and refreshes fresh data and permissions", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  // Wait for the per-link prefetch; Next can keep its partial rendering stream open.
  const contactsPrefetch = page.waitForResponse(response => {
    const req = response.request();
    return new URL(response.url()).pathname === "/admin/contacts" && req.headers().rsc === "1" && response.status() === 200 && Number(response.headers()["x-nextjs-stale-time"]) === 60;
  });
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await contactsPrefetch;
  const navigation = page.getByRole("navigation", { name: "Administración" });

  // Pause all further RSC responses: the first contacts visit must use the prefetch.
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/admin**", async route => {
    if (route.request().headers().rsc === "1") await blocked;
    await route.continue();
  });
  try {
    const start = Date.now();
    await navigation.getByRole("link", { name: "Contactos", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Contactos", exact: true })).toBeVisible({ timeout: 1500 });
    console.log(`Prefetched contacts navigation: ${Date.now() - start} ms (server responses paused)`);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }

  // Warm every screen, then prove returning to them does not depend on a new response.
  const screens = [
    ["Llamadas", "Llamadas"], ["WhatsApp", "WhatsApp"], ["Mi cuenta", "Mi cuenta"],
    ["Resumen", "Resumen"], ["Contactos", "Contactos"],
  ];
  for (const [label, heading] of screens) {
    await navigation.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  let releaseRevisits!: () => void;
  const revisitsBlocked = new Promise<void>(resolve => { releaseRevisits = resolve; });
  await page.route("**/admin**", async route => {
    if (route.request().headers().rsc === "1") await revisitsBlocked;
    await route.continue();
  });
  try {
    for (const [label, heading] of screens) {
      const start = Date.now();
      await navigation.getByRole("link", { name: label, exact: true }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 1500 });
      console.log(`Cached ${label} navigation: ${Date.now() - start} ms (server responses paused)`);
    }
  } finally { releaseRevisits(); await page.unrouteAll({ behavior: "wait" }); }

  // External updates are picked up immediately by the explicit refresh.
  leadId = (await db.query("insert into public.leads(name,email,phone) values('Cache refresh',$1,'+34612345678') returning id", [email])).rows[0].id;
  await expect(page.getByRole("link", { name: email, exact: true })).toHaveCount(0);
  await navigation.getByRole("button", { name: "Actualizar datos", exact: true }).click();
  await expect(page.getByRole("link", { name: email, exact: true })).toBeVisible();

  // Move browser time past the advertised TTL and verify an external update is read again.
  await navigation.getByRole("link", { name: "Mi cuenta", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mi cuenta", exact: true })).toBeVisible();
  await db.query("update public.leads set name='Expired cache' where id=$1", [leadId]);
  await page.clock.fastForward(61_000);
  await navigation.getByRole("link", { name: "Contactos", exact: true }).click();
  await expect(page.getByText("Expired cache", { exact: true })).toBeVisible();

  const guest = await browser.newContext();
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto(new URL("/admin/contacts", page.url()).href);
    await expect(guestPage).toHaveURL(/\/admin\/login$/);
    await expect(guestPage.getByRole("link", { name: email, exact: true })).toHaveCount(0);
  } finally { await guest.close(); }

  await db.query("update public.admin_accounts set active=false where user_id=$1", [userId]);
  await navigation.getByRole("button", { name: "Actualizar datos", exact: true }).click();
  await expect(page).toHaveURL(/denied=1/);
  expect(errors).toEqual([]);
});
