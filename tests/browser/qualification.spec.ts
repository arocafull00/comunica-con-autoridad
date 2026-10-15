import { test, expect } from "@playwright/test";
import { fillMasterclass, fillQualification } from "./masterclass-helper";
import { CAL_BOOKING_URL, GOALS, SITUATIONS } from "../../lib/leads/masterclass";
import { profileQualificationSchema } from "../../lib/leads/booking-validation";

test.beforeEach(async ({ page, context }) => {
  await page.route("https://fast.wistia.com/**", route => route.abort());
  await context.route("https://cal.com/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Calendario simulado</h1>" }));
  await page.route("**/api/leads/access", route => route.request().method() === "GET"
    ? route.fulfill({ json: { ok: true } })
    : route.fulfill({ status: 201, json: { ok: true, accessToken: "signed-test-reference" } }));
});

async function saveContact(page: import("@playwright/test").Page) {
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
}

test("contact, then profession, situation and goal from the first form, then Cal.com in another tab", async ({ page }, info) => {
  let requests = 0;
  await page.route("**/api/leads/qualification", route => {
    requests++;
    expect(route.request().headers().authorization).toBe("Bearer signed-test-reference");
    expect(profileQualificationSchema.parse(route.request().postDataJSON())).toEqual({ profession: "Dirección", situation: SITUATIONS[2], goal: GOALS[0] });
    return route.fulfill({ json: { ok: true, bookingUrl: CAL_BOOKING_URL } });
  });
  await saveContact(page);
  await expect(page.getByText("Pregunta 1 de 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "¿A qué te dedicas?" })).toBeVisible();
  await page.getByLabel("Profesión / actividad", { exact: true }).fill("Dirección");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "¿Cuál describe mejor tu situación actual?" })).toBeVisible();
  for (const option of SITUATIONS) await expect(page.getByRole("radio", { name: option, exact: true })).toBeVisible();
  await page.getByRole("radio", { name: SITUATIONS[2], exact: true }).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "¿Qué te gustaría mejorar principalmente?" })).toBeVisible();
  for (const option of GOALS) await expect(page.getByRole("radio", { name: option, exact: true })).toBeVisible();
  await page.reload();
  await fillQualification(page, false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/qualified-${info.project.name}.png`, fullPage: true });
  const calendarPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  const calendar = await calendarPromise;
  await expect(calendar).toHaveURL(CAL_BOOKING_URL);
  await expect(page).toHaveURL(/\/$/);
  expect(await calendar.evaluate(() => window.opener)).toBeNull();
  await calendar.close();
  expect(requests).toBe(1);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Agendar consultoría gratuita" })).toHaveAttribute("href", CAL_BOOKING_URL);
  await page.getByRole("button", { name: "Realizar otra inscripción" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("webinar_qualified_token_v1"))).toBeNull();
});

test("requires each answer, keeps selections when going back, and retries failed persistence", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/leads/qualification", route => {
    requests++;
    profileQualificationSchema.parse(route.request().postDataJSON());
    return route.fulfill({ status: requests === 1 ? 503 : 200, json: requests === 1 ? { ok: false, message: "No hemos podido confirmar el guardado." } : { ok: true, bookingUrl: CAL_BOOKING_URL } });
  });
  await saveContact(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Completa esta pregunta para continuar.", { exact: true })).toBeVisible();
  await page.getByLabel("Profesión / actividad").fill("Dirección"); await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Completa esta pregunta para continuar.", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: SITUATIONS[1], exact: true }).check(); await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  await expect(page.getByText("Completa esta pregunta para continuar.", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: GOALS[3], exact: true }).check();
  await page.getByRole("button", { name: "Atrás" }).click();
  await expect(page.getByRole("radio", { name: SITUATIONS[1], exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("radio", { name: GOALS[3], exact: true })).toBeChecked();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  await expect(page.getByText("No hemos podido confirmar el guardado.", { exact: true })).toBeVisible();
  await expect.poll(() => page.context().pages().length).toBe(1);
  const calendarPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  await expect(await calendarPromise).toHaveURL(CAL_BOOKING_URL);
  expect(requests).toBe(2);
});

test("an expired or email-only reference returns to the contact step", async ({ page }) => {
  await page.route("**/api/leads/qualification", route => route.fulfill({ status: 401, json: { ok: false, message: "Completa tus datos de acceso para continuar." } }));
  await page.addInitScript(() => localStorage.setItem("webinar_access_token_v1", "old-email-only-reference"));
  await page.goto("/");
  await fillQualification(page);
  await expect(page.getByLabel("Número de WhatsApp", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("webinar_access_token_v1"))).toBeNull();
});

test("keeps the saved calendar link when the browser blocks automatic tab opening", async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });
  await page.route("**/api/leads/qualification", route => route.fulfill({ json: { ok: true, bookingUrl: CAL_BOOKING_URL } }));
  await saveContact(page);
  await fillQualification(page);
  const link = page.getByRole("link", { name: "Agendar consultoría gratuita" });
  await expect(link).toHaveAttribute("href", CAL_BOOKING_URL);
  await expect(link).toHaveAttribute("target", "_blank");
  expect(page.context().pages()).toHaveLength(1);
});
