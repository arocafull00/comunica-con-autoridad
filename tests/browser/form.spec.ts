import { fillMasterclass } from "./masterclass-helper";
import { test, expect } from "@playwright/test";
import { contactSchema } from "../../lib/leads/booking-validation";

test.beforeEach(async ({ page }) => { await page.route("https://fast.wistia.com/**", route => route.abort()); });

test("shows the class on the first visit and the booking button before any form", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.locator("#webinar-content")).toBeVisible();
  await expect(page.locator("#video1-wrap")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agendar llamada" })).toBeVisible();
  await expect(page.getByRole("form")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Realizar otra inscripción" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/landing-${info.project.name}.png`, fullPage: true });
});

test("contact step asks for name, email and WhatsApp with two unticked, optional consents", async ({ page }, info) => {
  await page.goto("/");
  await fillMasterclass(page);
  const form = page.getByRole("form", { name: "Datos para agendar la llamada" });
  await expect(form.getByRole("checkbox")).toHaveCount(2);
  await expect(page.locator("#communicationsConsent")).not.toBeChecked();
  await expect(page.locator("#whatsappConsent")).not.toBeChecked();
  await expect(form).toContainText("comunicaciones por email");
  await expect(form).toContainText("mensajes de WhatsApp");
  await expect(form.getByLabel("Profesión / actividad")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/contact-${info.project.name}.png`, fullPage: true });
});

test.describe("consents travel independently", () => {
  for (const [email, whatsapp] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    test(`email=${email} whatsapp=${whatsapp}`, async ({ page }) => {
      await page.route("**/api/leads/access", async route => {
        expect(contactSchema.parse(route.request().postDataJSON())).toMatchObject({ name: "Adrián", email: "adrian@example.com", phone: "+34612345678",
          communicationsConsent: email, whatsappConsent: whatsapp });
        await route.fulfill({ status: 201, json: { ok: true, accessToken: "test-access-token" } });
      });
      await page.goto("/"); await fillMasterclass(page);
      if (email) await page.locator("#communicationsConsent").check();
      if (whatsapp) await page.locator("#whatsappConsent").check();
      await page.getByRole("button", { name: "Continuar" }).click();
      await expect(page.getByLabel("Profesión / actividad")).toBeVisible();
    });
  }
});

test("validates name, email and mobile before saving", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/leads/access", route => { requests++; return route.fulfill({ status: 201, json: { ok: true, accessToken: "t" } }); });
  await page.goto("/");
  await page.getByRole("button", { name: "Agendar llamada" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Introduce tu nombre (mínimo 2 caracteres).", { exact: true })).toBeVisible();
  await expect(page.getByText("Introduce un email válido.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Introduce un número de móvil válido/)).toBeVisible();
  await expect(page.getByLabel("Nombre", { exact: true })).toBeFocused();
  await page.getByLabel("Nombre", { exact: true }).fill("Adrián");
  await page.getByLabel("Email", { exact: true }).fill("adrian@example.com");
  await page.getByLabel("Número de WhatsApp", { exact: true }).fill("911234567");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText(/Introduce un número de móvil válido/)).toBeVisible();
  expect(requests).toBe(0);
});

test("waits for persistence and prevents double submits", async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/leads/access", async route => {
    requests++;
    expect(route.request().headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    await pending;
    await route.fulfill({ status: 201, json: { ok: true, accessToken: "test-access-token" } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("button", { name: "GUARDANDO..." })).toBeDisabled();
  await page.locator("#contact-form").dispatchEvent("submit");
  await expect(page.getByLabel("Profesión / actividad")).toHaveCount(0);
  release();
  await expect(page.getByLabel("Profesión / actividad")).toBeVisible();
  expect(requests).toBe(1);
});

test("keeps the data and idempotency key when retrying a failed request", async ({ page }) => {
  const keys: string[] = [];
  await page.route("**/api/leads/access", async route => {
    keys.push(route.request().headers()["idempotency-key"]);
    await route.fulfill({ status: keys.length === 1 ? 503 : 200, json: keys.length === 1
      ? { ok: false, message: "No hemos podido guardar tu solicitud." }
      : { ok: true, accessToken: "test-access-token" } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("form").getByRole("alert").filter({ hasText: "No hemos podido guardar" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("adrian@example.com");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByLabel("Profesión / actividad")).toBeVisible();
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
  await expect(page.getByLabel("Profesión / actividad")).toBeVisible();
  expect(keys[0]).not.toBe(keys[1]);
});
