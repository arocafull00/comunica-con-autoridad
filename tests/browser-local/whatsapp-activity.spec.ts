import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import pg from "pg";

test("WhatsApp activity links each status and error to its recipient and fits mobile", async ({ page }) => {
  const status = JSON.parse(execSync("pnpm exec supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  if (!["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local Auth only");
  const auth = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = new pg.Client({ connectionString: status.DB_URL });
  const email = `activity-admin-${randomUUID()}@example.com`;
  const password = `Local-${randomBytes(18).toString("hex")}`;
  const leadIds: string[] = [];
  let adminId: string | undefined;
  await db.connect();
  try {
    const admin = await auth.auth.admin.createUser({ email, password, email_confirm: true });
    if (admin.error) throw admin.error;
    adminId = admin.data.user.id;
    await db.query("insert into public.admin_accounts(user_id) values($1)", [adminId]);
    for (const [index, name] of ["Lead con fallo", "Lead pendiente"].entries()) {
      const contactEmail = `activity-contact-${randomUUID()}@example.com`;
      const lead = (await db.query("insert into public.leads(name,email,phone,idempotency_key) values($1,$2,$3,$4) returning id", [name, contactEmail, index ? "+33612345678" : "+34612345678", randomUUID()])).rows[0];
      leadIds.push(lead.id);
      const registration = (await db.query("insert into public.webinar_registrations(lead_id,email) values($1,$2) returning id", [lead.id, contactEmail])).rows[0];
      await db.query("insert into public.followup_jobs(registration_id,step,scheduled_at,expires_at,status,last_error) values($1,'webinar_1h','2098-01-01T10:00:00Z','2098-01-02T10:00:00Z',$2,$3)", [registration.id, index ? "pending" : "failed", index ? null : "meta_131026"]);
      if (!index) {
        await db.query("insert into public.followup_jobs(registration_id,step,scheduled_at,expires_at,status,last_error,payload) values($1,'webinar_1d','2098-01-01T10:01:00Z','2098-01-02T10:00:00Z','failed','delivery_unknown',$2)", [registration.id, JSON.stringify({ name: "Destinatario del envío", phone: "+447700900123" })]);
        await db.query("insert into public.followup_jobs(registration_id,step,scheduled_at,expires_at,status) values($1,'email_1','2099-01-01T10:00:00Z','2099-01-02T10:00:00Z','failed')", [registration.id]);
      }
    }
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/whatsapp");
    const table = page.getByRole("table", { name: "Actividad de los mensajes de WhatsApp" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText(["Lead", "Teléfono", "Mensaje", "Programado", "Estado", "Detalle"]);
    const failed = table.getByRole("row").filter({ hasText: "Lead con fallo" });
    await expect(failed.getByRole("cell")).toHaveCount(6);
    await expect(failed).toContainText("Fallido");
    await expect(failed).toContainText("meta_131026");
    await expect(failed.getByRole("link", { name: "+34612345678", exact: true })).toHaveAttribute("href", "https://wa.me/34612345678");
    await expect(failed.locator("time")).toHaveText("1 ene 2098, 11:00");
    const pending = table.getByRole("row").filter({ hasText: "Lead pendiente" });
    await expect(pending).toContainText("Pendiente");
    await expect(pending).toContainText("Sin incidencias");
    await expect(pending).toContainText("+33612345678");
    await expect(pending).not.toContainText("meta_131026");
    const uncertain = table.getByRole("row").filter({ hasText: "Destinatario del envío" });
    await expect(uncertain).toContainText("Resultado incierto · revisión manual");
    await expect(uncertain).toContainText("delivery_unknown");
    await expect(uncertain.getByRole("link")).toHaveAttribute("href", "https://wa.me/447700900123");
    await expect(uncertain).not.toContainText("+34612345678");
    await expect(table).not.toContainText("email_1");
    for (const width of [1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const cell of await failed.getByRole("cell").all()) {
        expect(await cell.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await table.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/whatsapp-activity-${width}.png`, fullPage: true });
    }
  } finally {
    if (leadIds.length) await db.query("delete from public.leads where id=any($1::uuid[])", [leadIds]);
    if (adminId) await auth.auth.admin.deleteUser(adminId);
    await db.end();
  }
});
