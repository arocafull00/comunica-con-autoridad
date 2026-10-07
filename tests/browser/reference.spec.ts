import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

for (const width of [320, 390, 768, 1280]) {
  test(`matches the supplied reference at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const reference = await context.newPage();
    await reference.setViewportSize({ width, height: 900 });
    await reference.route("**/__reference.html", route => route.fulfill({
      contentType: "text/html", body: readFileSync("reference/template.html", "utf8"),
    }));
    // Comparison needs no third-party video or contact submission.
    await reference.route("https://fast.wistia.com/**", route => route.abort());
    await reference.route("https://script.google.com/**", route => route.abort());
    await reference.goto("/__reference.html");
    await page.goto("/");
    for (const selector of [".brand", ".eyebrow", "h1", ".sub", ".access-btn", "footer"]) {
      const expected = await reference.locator(selector).boundingBox();
      const actual = await page.locator(`.webinar-page ${selector}`).boundingBox();
      expect(actual, selector).not.toBeNull();
      expect(expected, selector).not.toBeNull();
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(actual![key] - expected![key]), `${selector}.${key}`).toBeLessThan(1);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/masterclass-${width}.png`, fullPage: true });
    await reference.screenshot({ path: `test-results/reference-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "ACCEDER GRATIS A LA MASTERCLASS" }).click();
    await reference.locator("#open-form").click();
    for (const selector of ["#lead-form-wrap", ".form-head", ".form-step.active h3", ".next-btn"]) {
      const expected = await reference.locator(selector).first().boundingBox();
      const actual = await page.locator(selector).first().boundingBox();
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(actual![key] - expected![key]), `${selector}.${key}`).toBeLessThan(1);
      }
    }
    await reference.close();
  });
}

test("completion unlocks the replay and both access flags survive reload", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("webinar_access_granted_v3", "1"));
  await page.goto("/");
  await expect(page.locator("#video1-wrap")).toBeVisible();
  await expect(page.locator("#video2-wrap")).toBeHidden();
  await page.locator("#video1").dispatchEvent("ended");
  await expect(page.locator("#video2-wrap")).toBeVisible();
  await expect(page.locator("#video1-wrap")).toBeHidden();
  await expect(page.locator("#unlock-copy")).toContainText("Clase desbloqueada");
  await page.reload();
  await expect(page.locator("#video2-wrap")).toBeVisible();
  await expect(page.locator("#access-area")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "RESERVAR SESIÓN GRATUITA" })).toHaveAttribute("href", "https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion");
});
