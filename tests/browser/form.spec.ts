import { fillMasterclass } from "./masterclass-helper";
import { test, expect } from "@playwright/test";

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

test("contact step asks for name, email and WhatsApp", async ({ page }, info) => {
  await page.goto("/");
  await fillMasterclass(page);
  const form = page.getByRole("form", { name: "Datos para agendar la llamada" });
  await expect(form.getByRole("checkbox")).toHaveCount(0);
  await expect(form.getByLabel("Profesión / actividad")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/contact-${info.project.name}.png`, fullPage: true });
});

test("validates name, email and mobile before continuing", async ({ page }) => {
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
});

test("continues locally and leaves contact data out of browser storage", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
  });
  await page.goto("/");
  await fillMasterclass(page, "private@example.com");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByLabel("Profesión / actividad")).toBeVisible();
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }))).toEqual({ local: [], session: [] });
});
