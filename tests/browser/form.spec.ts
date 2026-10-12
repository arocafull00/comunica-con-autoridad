import { fillMasterclass } from "./masterclass-helper";
import { test, expect } from "@playwright/test";

test("first form asks for email and optional email consent only", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await fillMasterclass(page);
  const form = page.getByRole("form", { name: "Acceso a la masterclass" });
  await expect(form.getByRole("textbox", { name: "Email" })).toHaveCount(1);
  await expect(form.getByRole("checkbox")).toHaveCount(1);
  await expect(form.getByLabel("Nombre", { exact: true })).toHaveCount(0);
  await expect(form.getByLabel("Número de WhatsApp", { exact: true })).toHaveCount(0);
  await expect(page.locator("#communicationsConsent")).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/form-${info.project.name}.png`, fullPage: true });
});

test("submits only email consent and unlocks the webinar", async ({ page }) => {
  await page.route("**/api/leads/access", async route => {
    expect(route.request().postDataJSON()).toMatchObject({ email: "adrian@example.com", communicationsConsent: true });
    expect(route.request().postDataJSON()).not.toHaveProperty("phone");
    expect(route.request().postDataJSON()).not.toHaveProperty("name");
    await route.fulfill({ status: 201, json: { ok: true, accessToken: "test-access-token" } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.locator("#communicationsConsent").check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#webinar-content")).toBeVisible();
});

test("waits for persistence, prevents double click and accepts no email consent", async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/leads/access", async route => {
    requests++;
    expect(route.request().postDataJSON().communicationsConsent).toBe(false);
    expect(route.request().headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    await pending;
    await route.fulfill({ status: 201, json: { ok: true, accessToken: "test-access-token" } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("button", { name: "GUARDANDO..." })).toBeDisabled();
  await page.locator("#lead-form").dispatchEvent("submit");
  await expect(page.locator("#webinar-content")).toBeHidden();
  release();
  await expect(page.locator("#webinar-content")).toBeVisible();
  expect(requests).toBe(1);
});

test("keeps email and idempotency key when retrying a failed request", async ({ page }) => {
  const keys: string[] = [];
  await page.route("**/api/leads/access", async route => {
    keys.push(route.request().headers()["idempotency-key"]);
    await route.fulfill({ status: keys.length === 1 ? 503 : 200, json: keys.length === 1
      ? { ok: false, message: "No hemos podido guardar tu solicitud." }
      : { ok: true, accessToken: "test-access-token" } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("form").getByRole("alert")).toContainText("No hemos podido guardar");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("adrian@example.com");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#webinar-content")).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
});

test("focuses server email errors and uses a new key after changing email", async ({ page }) => {
  const keys: string[] = [];
  await page.route("**/api/leads/access", async route => {
    keys.push(route.request().headers()["idempotency-key"]);
    await route.fulfill({ status: keys.length === 1 ? 400 : 201, json: keys.length === 1
      ? { ok: false, message: "Revisa los datos", fieldErrors: { email: "Introduce un email válido" } }
      : { ok: true, accessToken: "test-access-token" } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  const email = page.getByLabel("Email", { exact: true });
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await email.fill("nuevo@example.com");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#webinar-content")).toBeVisible();
  expect(keys[0]).not.toBe(keys[1]);
});
