import { expect, type Page } from "@playwright/test";
import { GOALS, SITUATIONS } from "../../lib/leads/masterclass";

// Opens "Agendar llamada" and fills the contact step, leaving both consents as the caller sets them.
export async function fillMasterclass(page: Page, email = "adrian@example.com") {
  await page.getByRole("button", { name: "Agendar llamada" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Adrián");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await expect(page.locator(".iti__selected-dial-code")).toHaveText("+34");
  await page.getByLabel("Número de WhatsApp", { exact: true }).fill("612345678");
}
export async function fillQualification(page: Page, submit = true) {
  await page.getByLabel("Profesión / actividad", { exact: true }).fill("Dirección");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("radio", { name: SITUATIONS[2], exact: true }).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("radio", { name: GOALS[0], exact: true }).check();
  if (submit) await page.getByRole("button", { name: "Reservar llamada", exact: true }).click();
}
