import { test, expect } from "@playwright/test";
import { fillMasterclass, fillQualification } from "./masterclass-helper";
import { CAL_BOOKING_URL, GOALS, SITUATIONS } from "../../lib/leads/masterclass";
import { bookingSubmissionSchema } from "../../lib/leads/booking-validation";

test.beforeEach(async ({ page, context }) => {
  await page.route("https://fast.wistia.com/**", route => route.abort());
  await context.route("https://cal.com/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Calendario simulado</h1>" }));
});

async function continueWithContact(page: import("@playwright/test").Page) {
  await page.goto("/"); await fillMasterclass(page);
  await page.getByRole("button", { name: "Continuar" }).click();
}

test("sends the full form through the real API to Sheets before navigating to Cal.com", async ({ page, request, context }) => {
  await continueWithContact(page);
  await expect(page.getByText("Pregunta 1 de 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "¿A qué te dedicas?" })).toBeVisible();
  await page.getByLabel("Profesión / actividad", { exact: true }).fill("Dirección");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "¿Cuál describe mejor tu situación actual?" })).toBeVisible();
  for (const option of SITUATIONS) await expect(page.getByRole("radio", { name: option, exact: true })).toBeVisible();
  await page.getByRole("radio", { name: SITUATIONS[2], exact: true }).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "¿Qué te gustaría mejorar principalmente?" })).toBeVisible();
  await expect(page.locator('head link[rel="preconnect"][href="https://cal.com"]')).toHaveCount(1);
  for (const option of GOALS) await expect(page.getByRole("radio", { name: option, exact: true })).toBeVisible();
  await page.getByRole("radio", { name: GOALS[0], exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const saved = page.waitForResponse("**/api/leads/qualification");
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const id = response.request().headers()["idempotency-key"];
  const rows = await (await request.get("http://127.0.0.1:3102/submissions")).json();
  expect(rows).toContainEqual(expect.objectContaining({
    submission_id: id, email: "adrian@example.com", nombre: "Adrián", telefono: "+34612345678",
    a_que_te_dedicas: "Dirección", situacion_actual: SITUATIONS[2], que_quiere_mejorar: GOALS[0],
  }));
  await expect(page).toHaveURL(CAL_BOOKING_URL);
  expect(context.pages()).toEqual([page]);
  await page.goBack();
  await expect(page.getByRole("link", { name: "Agendar consultoría gratuita" })).toHaveAttribute("href", CAL_BOOKING_URL);
  await page.getByRole("button", { name: "Realizar otra inscripción" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("webinar_booking_ready_v1"))).toBeNull();
});

test("requires each answer, keeps selections when going back, and retries failed persistence", async ({ page }) => {
  const ids: string[] = [];
  await page.route("**/api/leads/qualification", route => {
    ids.push(route.request().headers()["idempotency-key"]);
    bookingSubmissionSchema.parse(route.request().postDataJSON());
    const failed = ids.length === 1;
    return route.fulfill({ status: failed ? 503 : 200, json: failed ? { ok: false, message: "No hemos podido confirmar el guardado." } : { ok: true, bookingUrl: CAL_BOOKING_URL } });
  });
  await continueWithContact(page);
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
  expect(ids).toHaveLength(0);
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  await expect(page.getByText("No hemos podido confirmar el guardado.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.context().pages().length).toBe(1);
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  await expect(page).toHaveURL(CAL_BOOKING_URL);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

test("an unfinished legacy registration starts again at the contact step", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("webinar_access_token_v1", "old-email-only-reference"));
  await page.goto("/");
  await page.getByRole("button", { name: "Agendar llamada" }).click();
  await expect(page.getByLabel("Número de WhatsApp", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("webinar_access_token_v1"))).toBeNull();
});

test("keeps the calendar link for a previously completed registration", async ({ page }) => {
  await page.addInitScript(() => {
    const token = `legacy.${Math.floor(Date.now() / 1000) + 3600}.signature`;
    localStorage.setItem("webinar_access_token_v1", token);
    localStorage.setItem("webinar_qualified_token_v1", token);
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Agendar consultoría gratuita" })).toHaveAttribute("href", CAL_BOOKING_URL);
  expect(await page.evaluate(() => localStorage.getItem("webinar_access_token_v1"))).toBeNull();
});

test("stays on the form while Sheets is pending and navigates without a popup", async ({ page, context }) => {
  let confirmSave!: () => void;
  const savePending = new Promise<void>(resolve => { confirmSave = resolve; });
  await page.route("**/api/leads/qualification", async route => {
    await savePending;
    await route.fulfill({ json: { ok: true, bookingUrl: CAL_BOOKING_URL } });
  });
  await continueWithContact(page);
  await fillQualification(page, false);
  await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
  try {
    await expect(page.getByRole("button", { name: /guardando/i })).toBeDisabled();
    await expect(page).toHaveURL(/\/$/);
    expect(context.pages()).toEqual([page]);
  } finally {
    confirmSave();
  }
  await expect(page).toHaveURL(CAL_BOOKING_URL);
  expect(context.pages()).toEqual([page]);
});

test("the published app exposes only the Sheets submission route", async ({ request }) => {
  expect((await request.get("/admin")).status()).toBe(404);
  for (const path of ["/api/leads", "/api/leads/access", "/api/leads/progress", "/api/funnel", "/api/webhooks/cal", "/api/webhooks/whatsapp"]) {
    expect((await request.post(path, { data: {} })).status(), path).toBe(404);
  }
  const invalid = await request.post("/api/leads/qualification", {
    headers: { "Idempotency-Key": "f4a211ab-4bc1-4443-a17f-8fa7534153b7" },
    data: { name: "Adrián", email: "adrian@example.com", phone: "+34911234567", profession: "", situation: SITUATIONS[2], goal: GOALS[0] },
  });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toMatchObject({ ok: false, fieldErrors: { phone: expect.any(String), profession: expect.any(String) } });
});
