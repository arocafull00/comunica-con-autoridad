import { expect, type Page } from "@playwright/test";
import { SITUATIONS, GOALS } from "../../lib/leads/masterclass";

export async function fillMasterclass(page: Page, email = "adrian@example.com") {
  await page.getByRole("button", { name: "ACCEDER GRATIS A LA MASTERCLASS" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Adrián");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Profesión / actividad", { exact: true }).fill("Dirección");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: SITUATIONS[2], exact: true }).click();
  await page.getByRole("button", { name: GOALS[0], exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator(".iti__selected-dial-code")).toHaveText("+34");
  await page.getByLabel("Móvil / WhatsApp", { exact: true }).fill("612345678");
}
