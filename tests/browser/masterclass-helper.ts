import { expect, type Page } from "@playwright/test";
import { ADMISSION_DECISIONS, BOOKING_GOALS, COMMITMENTS, INVESTMENTS, SITUATIONS } from "../../lib/leads/masterclass";

export const APPLICATION_REASONS = "Lidero un equipo y quiero comunicar con más autoridad en reuniones y negociaciones.";

// Opens "Agendar llamada" and fills the contact step, leaving both consents as the caller sets them.
export async function fillMasterclass(page: Page, email = "adrian@example.com") {
  await page.getByRole("button", { name: "Agendar llamada" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Adrián");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await expect(page.locator(".iti__selected-dial-code")).toHaveText("+34");
  await page.getByLabel("Número de WhatsApp", { exact: true }).fill("612345678");
}
export async function fillQualification(page: Page, decision: typeof ADMISSION_DECISIONS[number] = ADMISSION_DECISIONS[0], submit = true) {
  await page.getByLabel("Profesión / actividad", { exact: true }).fill("Dirección");
  await page.getByRole("button", { name: "Continuar" }).click();
  for (const option of [SITUATIONS[2], BOOKING_GOALS[0], COMMITMENTS[0], INVESTMENTS[1]]) {
    await page.getByRole("radio", { name: option, exact: true }).check();
    await page.getByRole("button", { name: "Continuar" }).click();
  }
  await page.getByLabel("Tu candidatura", { exact: true }).fill(APPLICATION_REASONS);
  await page.getByRole("button", { name: "Continuar" }).click();
  if (decision === ADMISSION_DECISIONS[1]) await page.getByRole("radio", { name: decision, exact: true }).check();
  await expect(page.getByRole("radio", { name: decision, exact: true })).toBeChecked();
  if (submit) await page.getByRole("button", { name: decision === ADMISSION_DECISIONS[0] ? "Reservar llamada" : "Guardar respuestas", exact: true }).click();
}
