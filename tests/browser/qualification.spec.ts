import { test, expect } from "@playwright/test";
import { APPLICATION_REASONS, fillMasterclass, fillQualification } from "./masterclass-helper";
import { ADMISSION_DECISIONS, BOOKING_GOALS, COMMITMENTS, INVESTMENTS, CAL_BOOKING_URL } from "../../lib/leads/masterclass";
import { qualificationSchema } from "../../lib/leads/booking-validation";

test.beforeEach(async ({ page }) => {
  await page.route("https://fast.wistia.com/**", route => route.abort());
  await page.route("https://cal.com/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Calendario simulado</h1>" }));
  await page.route("**/api/leads/access", route => route.fulfill({ status: 201, json: { ok: true, accessToken: "signed-test-reference" } }));
});

test("contact opens video and questions, then saving opens Cal.com and survives returning", async ({ page }, info) => {
  let requests = 0;
  await page.route("**/api/leads/qualification", route => {
    requests++;
    expect(route.request().headers().authorization).toBe("Bearer signed-test-reference");
    expect(qualificationSchema.parse(route.request().postDataJSON())).toEqual({ profession: "Dirección", goal: BOOKING_GOALS[0], commitment: COMMITMENTS[0], investment: INVESTMENTS[1],
      applicationReasons: APPLICATION_REASONS, admissionDecision: ADMISSION_DECISIONS[0] });
    return route.fulfill({ json: { ok: true, bookingUrl: CAL_BOOKING_URL } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await expect(page.getByLabel("Profesión / actividad")).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#video1-wrap")).toBeVisible();
  await expect(page.getByRole("link", { name: "Reservar llamada" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reservar llamada" })).toHaveCount(0);
  await expect(page.getByLabel("Profesión / actividad")).toBeVisible();
  await page.reload();
  await fillQualification(page, ADMISSION_DECISIONS[0], false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/qualified-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  await expect(page).toHaveURL(CAL_BOOKING_URL);
  expect(requests).toBe(1);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Abrir calendario" })).toHaveAttribute("href", CAL_BOOKING_URL);
  await page.reload();
  await expect(page.getByRole("link", { name: "Abrir calendario" })).toBeVisible();
  await page.getByRole("button", { name: "Realizar otra inscripción" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("webinar_qualified_token_v1"))).toBeNull();
});

test("requires each answer, keeps selections when going back, and retries failed persistence", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/leads/qualification", route => {
    requests++;
    qualificationSchema.parse(route.request().postDataJSON());
    return route.fulfill({ status: requests === 1 ? 503 : 200, json: requests === 1 ? { ok: false, message: "No hemos podido confirmar el guardado." } : { ok: true, bookingUrl: CAL_BOOKING_URL } });
  });
  await page.goto("/"); await fillMasterclass(page); await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("button", { name: "Reservar llamada" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Completa esta pregunta para continuar.", { exact: true })).toBeVisible();
  await page.getByLabel("Profesión / actividad").fill("Dirección"); await page.getByRole("button", { name: "Continuar" }).click();
  for (const option of [BOOKING_GOALS[0], COMMITMENTS[0]]) {
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByText("Completa esta pregunta para continuar.", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: option, exact: true }).check(); await page.getByRole("button", { name: "Continuar" }).click();
  }
  await page.getByRole("radio", { name: INVESTMENTS[1], exact: true }).check();
  await page.getByRole("button", { name: "Atrás" }).click();
  await expect(page.getByRole("radio", { name: COMMITMENTS[0], exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("radio", { name: INVESTMENTS[1], exact: true })).toBeChecked();
  await page.screenshot({ path: "test-results/investment-question.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Continuar" }).click();
  expect(requests).toBe(0);
  await expect(page.getByText("Pregunta 5 de 6", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Completa esta pregunta para continuar.", { exact: true })).toBeVisible();
  await page.getByLabel("Tus 3 razones", { exact: true }).fill(APPLICATION_REASONS);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("radio", { name: ADMISSION_DECISIONS[0], exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Reservar llamada", exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Atrás" }).click();
  await expect(page.getByLabel("Tus 3 razones", { exact: true })).toHaveValue(APPLICATION_REASONS);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("radio", { name: ADMISSION_DECISIONS[0], exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  await expect(page.getByText("No hemos podido confirmar el guardado.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("radio", { name: ADMISSION_DECISIONS[0], exact: true })).toBeChecked();
  await expect(page.getByRole("link", { name: "Reservar llamada" })).toHaveCount(0);
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  await expect(page).toHaveURL(CAL_BOOKING_URL);
  expect(requests).toBe(2);
});

test("older saved access asks for contact details before booking", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("webinar_access_granted_v3", "1"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Reservar llamada" })).toHaveCount(0);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reservar llamada" })).toHaveCount(0);
});

test("waits for saving before navigation and ignores duplicate submits", async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/leads/qualification", async route => {
    requests++;
    await pending;
    await route.fulfill({ json: { ok: true, bookingUrl: CAL_BOOKING_URL } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await fillQualification(page);
  await expect(page.getByRole("button", { name: "GUARDANDO..." })).toBeDisabled();
  await page.getByRole("form", { name: "Preguntas para reservar llamada" }).dispatchEvent("submit");
  await expect(page).toHaveURL(/\/$/);
  release();
  await expect(page).toHaveURL(CAL_BOOKING_URL);
  expect(requests).toBe(1);
});

test("changes the final label and saves declining without opening Cal.com, including after reload", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/leads/qualification", route => {
    requests++;
    expect(qualificationSchema.parse(route.request().postDataJSON()).admissionDecision).toBe(ADMISSION_DECISIONS[1]);
    return route.fulfill({ json: { ok: true, message: "Tus respuestas están guardadas." } });
  });
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await fillQualification(page, ADMISSION_DECISIONS[1], false);
  await expect(page.getByRole("button", { name: "No reservaré llamada", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: ADMISSION_DECISIONS[0], exact: true }).check();
  await expect(page.getByRole("button", { name: "Reservar llamada", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: ADMISSION_DECISIONS[1], exact: true }).check();
  await page.getByRole("button", { name: "No reservaré llamada", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "No reservarás" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(requests).toBe(1);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "No reservarás" })).toBeVisible();
  await expect(page.locator("#after a")).toHaveCount(0);
  await page.getByRole("button", { name: "Realizar otra inscripción" }).click();
  expect(await page.evaluate(() => localStorage.getItem("webinar_declined_token_v1"))).toBeNull();
});
