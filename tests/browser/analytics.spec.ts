import { fillMasterclass } from "./masterclass-helper";
import { expect, test, type Page } from "@playwright/test";

// Simulate the hosted collector, exercising the real SDK and beforeSend callback.
// No request is sent to Vercel and the hosted script is never downloaded.
async function mockCollector(page: Page) {
  await page.route("**/_vercel/insights/script.js", (route) => route.fulfill({ contentType: "application/javascript", body: `
    window.__analyticsEvents = [];
    let beforeSend = event => event;
    function collect(command, properties) {
      if (command === 'beforeSend') { beforeSend = properties; return; }
      const event = beforeSend({ type: command === 'event' ? 'event' : 'pageview', url: location.href });
      if (event) window.__analyticsEvents.push({ ...event, ...(command === 'event' ? properties : {}) });
    }
    const queue = window.vaq || [];
    window.va = collect;
    queue.forEach(args => collect(...args));
  ` }));
}
async function events(page: Page) {
  return page.evaluate(() => (window as unknown as { __analyticsEvents: { type: string; url: string; name?: string; data?: unknown }[] }).__analyticsEvents ?? []);
}


test("pageviews and conversions exclude queries, fragments and lead data", async ({ page }) => {
  await mockCollector(page);
  await page.route("**/api/leads", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ utmSource: "instagram", utmMedium: "paid", utmCampaign: "curso" });
    await route.fulfill({ status: 201, json: { ok: true, message: "Solicitud guardada" } });
  });
  await page.goto("/?utm_source=instagram&utm_medium=paid&utm_campaign=curso&email=private@example.com#phone");
  await expect.poll(async () => (await events(page)).filter((event) => event.type === "pageview").length).toBeGreaterThan(0);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "strict-origin");
  await fillMasterclass(page, "private@example.com"); await page.getByRole("button", { name: "DESBLOQUEAR MASTERCLASS" }).click();
  await expect(page.locator("#webinar-content")).toBeVisible();
  await expect.poll(async () => (await events(page)).filter((event) => event.name === "lead_submitted").length).toBe(1);
  const recorded = await events(page);
  expect(recorded.every((event) => event.url === "http://127.0.0.1:3100/")).toBe(true);
  const conversion = recorded.find((event) => event.name === "lead_submitted")!;
  expect(conversion.data).toBeUndefined();
  expect(JSON.stringify(recorded)).not.toMatch(/private@example|612345678|Adrián|instagram|curso/);
});

test("failed submissions and successful idempotent replays do not emit conversions", async ({ page }) => {
  await mockCollector(page); let attempts = 0;
  await page.route("**/api/leads", async (route) => {
    attempts++;
    await route.fulfill({ status: attempts === 1 ? 503 : 200,
      json: { ok: attempts !== 1, message: attempts === 1 ? "Vuelve a intentarlo" : "Solicitud ya guardada" } });
  });
  await page.goto("/");
  await expect.poll(async () => (await events(page)).length).toBeGreaterThan(0);
  await fillMasterclass(page, "private@example.com"); await page.getByRole("button", { name: "DESBLOQUEAR MASTERCLASS" }).click();
  await expect(page.getByRole("form").getByRole("alert")).toContainText("Vuelve a intentarlo");
  expect((await events(page)).filter((event) => event.name === "lead_submitted")).toHaveLength(0);
  await page.getByRole("button", { name: "DESBLOQUEAR MASTERCLASS" }).click();
  await expect(page.locator("#webinar-content")).toBeVisible();
  expect((await events(page)).filter((event) => event.name === "lead_submitted")).toHaveLength(0);
});

test("a collector failure does not undo the saved lead confirmation", async ({ page }) => {
  await mockCollector(page);
  await page.route("**/api/leads", (route) => route.fulfill({ status: 201, json: { ok: true, message: "Solicitud guardada" } }));
  await page.goto("/");
  await expect.poll(async () => (await events(page)).length).toBeGreaterThan(0);
  await page.evaluate(() => { window.va = () => { throw new Error("blocked analytics"); }; });
  await fillMasterclass(page, "private@example.com"); await page.getByRole("button", { name: "DESBLOQUEAR MASTERCLASS" }).click();
  await expect(page.locator("#webinar-content")).toBeVisible();
});
