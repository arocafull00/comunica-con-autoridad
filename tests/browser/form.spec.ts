import { fillMasterclass } from "./masterclass-helper";
import { test, expect } from "@playwright/test";



test("Spanish contact form fits viewport with two optional unchecked consents", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await fillMasterclass(page);
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await expect(page.locator("#whatsappConsent")).not.toBeChecked();
  await expect(page.locator("#communicationsConsent")).not.toBeChecked();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/form-${info.project.name}.png`, fullPage: true });
});

test("sends independent consent choices and unlocks the webinar", async ({ page }) => {
  await page.route("**/api/leads/access", async route => {
    expect(route.request().postDataJSON()).toMatchObject({ whatsappConsent: true, communicationsConsent: true });
    await route.fulfill({ status: 201, json: { ok: true, accessToken: "test-access-token" } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.locator("#whatsappConsent").check();
  await page.locator("#communicationsConsent").check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#webinar-content")).toBeVisible();
});

test("waits for persistence, prevents double click and confirms without consent", async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/leads/access", async (route) => {
    requests++;
    expect(route.request().postDataJSON().whatsappConsent).toBe(false);
    expect(route.request().headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    await pending;
    await route.fulfill({ status: 201, json: { ok: true, accessToken: "test-access-token", message: "Gracias, hemos recibido tu solicitud." } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("button", { name: "GUARDANDO..." })).toBeDisabled();
  await page.locator("form").dispatchEvent("submit");
  await expect(page.locator("#webinar-content")).toBeHidden();
  release();
  await expect(page.locator("#webinar-content")).toBeVisible();
  expect(requests).toBe(1);
});

test("keeps data and idempotency key when retrying a failed request", async ({ page }) => {
  const keys: string[] = [];
  await page.route("**/api/leads/access", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    await route.fulfill({ status: keys.length === 1 ? 503 : 200, json: keys.length === 1
      ? { ok: false, message: "No hemos podido guardar tu solicitud." }
      : { ok: true, accessToken: "test-access-token", message: "Gracias, hemos recibido tu solicitud." } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("form").getByRole("alert")).toContainText("No hemos podido guardar");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("adrian@example.com");
  await expect(page.getByLabel("Móvil / WhatsApp", { exact: true })).toHaveValue("612 34 56 78");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#webinar-content")).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
});

test("shows field errors and creates a new key when the content changes", async ({ page }) => {
  const keys: string[] = [];
  await page.route("**/api/leads/access", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    expect(route.request().postDataJSON().whatsappConsent).toBe(false);
    await route.fulfill({ status: keys.length === 1 ? 400 : 201, json: keys.length === 1
      ? { ok: false, message: "Revisa los datos", fieldErrors: { phone: "Introduce un teléfono válido" } }
      : { ok: true, accessToken: "test-access-token", message: "Solicitud guardada" } });
  });
  await page.goto("/"); await fillMasterclass(page);
  
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByLabel("Móvil / WhatsApp", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Introduce un teléfono válido", { exact: true })).toBeVisible();
  await page.getByLabel("Móvil / WhatsApp", { exact: true }).fill("+33 6 12 34 56 78");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#webinar-content")).toBeVisible();
  expect(keys[0]).not.toBe(keys[1]);
});

test("network failure preserves inputs and no success is shown", async ({ page }) => {
  await page.route("**/api/leads/access", (route) => route.abort("failed"));
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("form").getByRole("alert")).toContainText("No hemos podido confirmar");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("adrian@example.com");
  await expect(page.locator("#webinar-content")).toBeHidden();
});
