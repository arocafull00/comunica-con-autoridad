import { ADMISSION_DECISIONS, BOOKING_GOALS, COMMITMENTS, INVESTMENTS, CAL_BOOKING_URL } from "../../lib/leads/masterclass";
import { APPLICATION_REASONS, fillMasterclass, fillQualification } from "../browser/masterclass-helper";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import pg from "pg";

test("real Next API saves leads and queues only consented welcomes while WhatsApp is offline", async ({ page, request }) => {
  const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
  await db.connect();
  const email = `browser-${randomUUID()}@example.com`;
  const campaign = `browser_${randomUUID()}`;
  try {
    await page.goto(`/?utm_source=tests_local&utm_medium=e2e&utm_campaign=${campaign}`);
    await fillMasterclass(page, email);
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.locator("#webinar-content")).toBeVisible();
    let saved = await db.query("select l.name, l.whatsapp_consent, l.phone, l.utm_source, l.utm_medium, l.utm_campaign, l.profession, l.situation, l.goal, (select count(*)::int from public.whatsapp_messages m where m.lead_id=l.id) as messages from public.leads l where email=$1", [email]);
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0]).toEqual({ name: "Adrián", whatsapp_consent: false, phone: "+34612345678", messages: 0, utm_source: "tests_local", utm_medium: "e2e", utm_campaign: campaign, profession: null, situation: null, goal: null });
    const sheets = await request.get("http://127.0.0.1:3102/submissions");
    expect((await sheets.json()).filter((row: { email: string }) => row.email === email)).toEqual([
      expect.objectContaining({ nombre: "Adrián", email, telefono: "+34612345678", telefono_pais: "ES", telefono_prefijo: "+34",
        a_que_te_dedicas: "", situacion_actual: "", que_quiere_mejorar: "" }),
    ]);
    await page.route("https://cal.com/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Calendario simulado</h1>" }));
    await fillQualification(page);
    await expect(page).toHaveURL(CAL_BOOKING_URL);
    const qualified = await db.query("select name,profession,goal,commitment,investment,application_reasons,admission_decision from public.leads where email=$1", [email]);
    expect(qualified.rows).toEqual([{ name: "Adrián", profession: "Dirección", goal: BOOKING_GOALS[0], commitment: COMMITMENTS[0], investment: INVESTMENTS[1],
      application_reasons: APPLICATION_REASONS, admission_decision: ADMISSION_DECISIONS[0] }]);
    const updatedSheets = await request.get("http://127.0.0.1:3102/submissions");
    expect((await updatedSheets.json()).filter((row: { email: string }) => row.email === email)).toEqual([
      expect.objectContaining({ a_que_te_dedicas: "Dirección", que_quiere_mejorar: BOOKING_GOALS[0], nivel_compromiso: COMMITMENTS[0], rango_inversion: INVESTMENTS[1],
        razones_para_reservar: APPLICATION_REASONS, decision_admision: ADMISSION_DECISIONS[0] }),
    ]);
    const report = await db.query("select public.get_lead_metrics((now() at time zone 'Europe/Madrid')::date, (now() at time zone 'Europe/Madrid')::date + 1) as metrics");
    const attributed = report.rows[0].metrics.campaigns.find((entry: { utm_campaign: string | null }) => entry.utm_campaign === campaign);
    expect(attributed).toMatchObject({ utm_source: "tests_local", utm_medium: "e2e", leads: 1, unique_emails: 1 });
    const key = randomUUID();
    const data = { name: "Prueba local", phone: "+33612345678", email, whatsappConsent: true, website: "" };
    const headers = { "Idempotency-Key": key };
    const first = await request.post("/api/leads", { headers, data }); expect(first.status()).toBe(201);
    const replay = await request.post("/api/leads", { headers, data }); expect(replay.status()).toBe(200);
    const copies = await request.get("http://127.0.0.1:3102/submissions");
    expect((await copies.json()).filter((row: { submission_id: string }) => row.submission_id === key)).toHaveLength(1);
    const conflict = await request.post("/api/leads", { headers, data: { ...data, name: "Otro nombre" } }); expect(conflict.status()).toBe(409);
    saved = await db.query("select m.status, m.attempts, q.msg_id from public.whatsapp_messages m join public.leads l on l.id=m.lead_id join pgmq.q_whatsapp_outbound q on q.message->>'messageId'=m.id::text where l.idempotency_key=$1", [key]);
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect((await db.query("select active from cron.job where jobname='process-whatsapp-queue'")).rows[0].active).toBe(false);
  } finally {
    await db.query("begin");
    await db.query("delete from pgmq.q_whatsapp_outbound q using public.whatsapp_messages m, public.leads l where q.message->>'messageId'=m.id::text and m.lead_id=l.id and l.email=$1", [email]);
    await db.query("delete from public.whatsapp_messages m using public.leads l where m.lead_id=l.id and l.email=$1", [email]);
    await db.query("delete from public.leads where email=$1", [email]);
    await db.query("commit");
    await db.end();
  }
});
