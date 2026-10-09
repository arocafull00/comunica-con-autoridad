import { expect, type Page } from "@playwright/test";
import { ADMISSION_DECISIONS, BOOKING_GOALS, COMMITMENTS, INVESTMENTS } from "../../lib/leads/masterclass";

export const APPLICATION_REASONS = "Quiero liderar mejor, hablar con seguridad y comunicar con claridad.";

export async function fillMasterclass(page: Page, email = "adrian@example.com") {
  await page.getByRole("button", { name: "ACCEDER GRATIS A LA MASTERCLASS" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Adrián");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await expect(page.locator(".iti__selected-dial-code")).toHaveText("+34");
  await page.getByLabel("Número de teléfono", { exact: true }).fill("612345678");
}
export async function fillQualification(page: Page) {
  await page.getByRole("button", { name: "Reservar llamada" }).click();
  await page.getByLabel("Profesión / actividad", { exact: true }).fill("Dirección");
  await page.getByRole("button", { name: "Continuar" }).click();
  for (const option of [BOOKING_GOALS[0], COMMITMENTS[0], INVESTMENTS[1]]) {
    await page.getByRole("radio", { name: option, exact: true }).check();
    await page.getByRole("button", { name: "Continuar" }).click();
  }
  await page.getByLabel("Tus 3 razones", { exact: true }).fill(APPLICATION_REASONS);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("radio", { name: ADMISSION_DECISIONS[0], exact: true }).check();
  await page.getByRole("button", { name: "Continuar" }).click();
}
