import { test, expect } from "@playwright/test";
import { APPLICATION_REASONS, fillMasterclass, fillQualification } from "./masterclass-helper";
import { ADMISSION_DECISIONS, BOOKING_GOALS, COMMITMENTS, INVESTMENTS, CAL_BOOKING_URL, SITUATIONS } from "../../lib/leads/masterclass";
import { candidateQualificationSchema } from "../../lib/leads/booking-validation";

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

test("contact, seven questions with the situation after profession, then Cal.com in another tab", async ({ page }, info) => {
  let requests = 0;
  await page.route("**/api/leads/qualification", route => {
    requests++;
    expect(route.request().headers().authorization).toBe("Bearer signed-test-reference");
    expect(candidateQualificationSchema.parse(route.request().postDataJSON())).toEqual({ profession: "Dirección", situation: SITUATIONS[2], goal: BOOKING_GOALS[0],
      commitment: COMMITMENTS[0], investment: INVESTMENTS[1], applicationReasons: APPLICATION_REASONS, admissionDecision: ADMISSION_DECISIONS[0] });
    return route.fulfill({ json: { ok: true, bookingUrl: CAL_BOOKING_URL } });
  });
  await saveContact(page);
  await expect(page.getByText("Pregunta 1 de 7", { exact: true })).toBeVisible();
  await page.getByLabel("Profesión / actividad", { exact: true }).fill("Dirección");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "¿En qué punto te encuentras actualmente?" })).toBeVisible();
  for (const option of SITUATIONS) await expect(page.getByRole("radio", { name: option, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Atrás" }).click();
  await page.reload();
  await fillQualification(page, ADMISSION_DECISIONS[0], false);
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
  await expect(page.getByRole("link", { name: "Abrir calendario" })).toHaveAttribute("href", CAL_BOOKING_URL);
  await expect(page.getByRole("link", { name: "Abrir calendario" })).toHaveAttribute("target", "_blank");
  await page.getByRole("button", { name: "Realizar otra inscripción" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("webinar_qualified_token_v1"))).toBeNull();
});

test("shows the candidature question from the PDF without asking for three reasons", async ({ page }, info) => {
  await saveContact(page);
  await page.getByLabel("Profesión / actividad", { exact: true }).fill("Dirección");
  await page.getByRole("button", { name: "Continuar" }).click();
  for (const option of [SITUATIONS[0], BOOKING_GOALS[0], COMMITMENTS[0], INVESTMENTS[0]]) {
    await page.getByRole("radio", { name: option, exact: true }).check();
    await page.getByRole("button", { name: "Continuar" }).click();
  }
  const step = page.locator(".form-step.active");
  await expect(step).toContainText("Seleccionamos cuidadosamente a las personas con las que trabajamos.");
  await expect(step.getByRole("heading")).toHaveText("¿Por qué consideras que deberíamos elegir tu candidatura para formar parte del programa?");
  await expect(step).not.toContainText(/3 razones|tres razones/i);
  await expect(page.getByLabel("Tu candidatura", { exact: true })).toHaveAttribute("placeholder", "Cuéntanos por qué encajas en el programa...");
  await page.screenshot({ path: `test-results/candidature-${info.project.name}.png`, fullPage: true });
});

test("requires each answer, keeps selections when going back, and retries failed persistence", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/leads/qualification", route => {
    requests++;
    candidateQualificationSchema.parse(route.request().postDataJSON());
    return route.fulfill({ status: requests === 1 ? 503 : 200, json: requests === 1 ? { ok: false, message: "No hemos podido confirmar el guardado." } : { ok: true, bookingUrl: CAL_BOOKING_URL } });
  });
  await saveContact(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Completa esta pregunta para continuar.", { exact: true })).toBeVisible();
  await page.getByLabel("Profesión / actividad").fill("Dirección"); await page.getByRole("button", { name: "Continuar" }).click();
  for (const option of [SITUATIONS[1], BOOKING_GOALS[0], COMMITMENTS[0]]) {
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByText("Completa esta pregunta para continuar.", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: option, exact: true }).check(); await page.getByRole("button", { name: "Continuar" }).click();
  }
  await page.getByRole("radio", { name: INVESTMENTS[1], exact: true }).check();
  await page.getByRole("button", { name: "Atrás" }).click();
  await expect(page.getByRole("radio", { name: COMMITMENTS[0], exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("radio", { name: INVESTMENTS[1], exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Pregunta 6 de 7", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Completa esta pregunta para continuar.", { exact: true })).toBeVisible();
  await page.getByLabel("Tu candidatura", { exact: true }).fill(APPLICATION_REASONS);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("radio", { name: ADMISSION_DECISIONS[0], exact: true })).toBeChecked();
  expect(requests).toBe(0);
  const failedCalendarPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  const failedCalendar = await failedCalendarPromise;
  await expect(page.getByText("No hemos podido confirmar el guardado.", { exact: true })).toBeVisible();
  await expect.poll(() => failedCalendar.isClosed()).toBe(true);
  await expect(page.getByRole("radio", { name: ADMISSION_DECISIONS[0], exact: true })).toBeChecked();
  const calendarPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  await expect(await calendarPromise).toHaveURL(CAL_BOOKING_URL);
  await expect(page).toHaveURL(/\/$/);
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
  const link = page.getByRole("link", { name: "Abrir calendario" });
  await expect(link).toHaveAttribute("href", CAL_BOOKING_URL);
  await expect(link).toHaveAttribute("target", "_blank");
  expect(page.context().pages()).toHaveLength(1);
  const calendar = page.waitForEvent("popup");
  await link.click();
  await expect(await calendar).toHaveURL(CAL_BOOKING_URL);
});

test("changes the final label and saves declining without opening Cal.com, including after reload", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/leads/qualification", route => {
    requests++;
    expect(candidateQualificationSchema.parse(route.request().postDataJSON()).admissionDecision).toBe(ADMISSION_DECISIONS[1]);
    return route.fulfill({ json: { ok: true, message: "Tus respuestas están guardadas." } });
  });
  await saveContact(page);
  await fillQualification(page, ADMISSION_DECISIONS[1], false);
  await expect(page.getByRole("button", { name: "Guardar respuestas", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Guardar respuestas", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "No reservarás" })).toBeVisible();
  expect(requests).toBe(1);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "No reservarás" })).toBeVisible();
  await expect(page.locator("#after a")).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
  await page.getByRole("button", { name: "Realizar otra inscripción" }).click();
  expect(await page.evaluate(() => localStorage.getItem("webinar_declined_token_v1"))).toBeNull();
});
