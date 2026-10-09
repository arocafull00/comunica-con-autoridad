import assert from "node:assert/strict";
import { createFollowupHandler } from "./handler.ts";
import { handleFollowupWorker, loadFollowupConfig, processFollowups, sendFollowup, type FollowupMessage, type FollowupRpc } from "./worker.ts";

const secret = "test-only-unsubscribe-secret-at-least-32-characters";
const env = { FOLLOWUP_EMAIL_SEND_ENABLED: "true",
  RESEND_API_KEY: "test-key", RESEND_FROM: "Ignacio <test@example.com>", ADMIN_SITE_URL: "https://example.com", EMAIL_UNSUBSCRIBE_SECRET: secret };
const config = { email: { key: env.RESEND_API_KEY, from: env.RESEND_FROM, siteUrl: env.ADMIN_SITE_URL, unsubscribeSecret: secret },
  whatsapp: { token: "test-token", phoneNumberId: "123", version: "v99.0" } };
const message: FollowupMessage = { id: crypto.randomUUID(), registrationId: crypto.randomUUID(), channel: "email", step: "email_2",
  email: "test@example.com", phone: "+34612345678", name: "Adrián", time: "16:00 (Europe/Madrid)", meetingUrl: "https://meet.google.com/abc",
  subject: "Clase", body: "Hola {{name}}", parameter: null, templateName: "approved_template", templateLanguage: "es" };
const fetchJson = (body: object, status = 200): typeof fetch => async () => Response.json(body, { status });
const noRpc: FollowupRpc = () => { throw new Error("Must not access the database"); };
const noFetch: typeof fetch = () => { throw new Error("Must not send"); };
const authEnv = { url: "https://example.com", secretKeys: { default: "sb_secret_test_private_key" }, publishableKeys: { default: "sb_publishable_test_key" }, jwks: { keys: [] } };
const request = (key = authEnv.secretKeys.default, method = "POST") => new Request("https://example.com/functions/v1/process-followup-queue", { method, headers: { apikey: key } });

const testEnv = { FOLLOWUP_WHATSAPP_TEST_ENABLED: "true", WHATSAPP_TEST_ACCESS_TOKEN: "sandbox-token",
  WHATSAPP_TEST_PHONE_NUMBER_ID: "123", WHATSAPP_TEST_GRAPH_API_VERSION: "v99.0", WHATSAPP_TEST_RECIPIENT: message.phone };
const testMessage: FollowupMessage = { ...message, channel: "whatsapp", testMode: true, templateName: "hello_world", templateLanguage: "en_US" };

Deno.test("sandbox activation disables paid credentials even when both flags are set", () => {
  const loaded = loadFollowupConfig({ ...testEnv, FOLLOWUP_WHATSAPP_SEND_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "paid",
    WHATSAPP_PHONE_NUMBER_ID: "999", WHATSAPP_GRAPH_API_VERSION: "v99.0" });
  assert.equal(loaded.whatsapp, null); assert.equal(loaded.whatsappTest?.token, "sandbox-token");
  assert.equal(loadFollowupConfig({ ...testEnv, WHATSAPP_TEST_RECIPIENT: "invalid" }).whatsappTest, undefined);
});

Deno.test("sandbox refuses a real sender before reading the test queue", async () => {
  const calls: string[] = [];
  const rpc: FollowupRpc = <T>(name: string) => { calls.push(name); return Promise.resolve([] as T); };
  const response = await handleFollowupWorker(request(), testEnv, rpc, fetchJson({ id: "123", display_phone_number: "+34 612345678" }));
  assert.equal(response.status, 503); assert.deepEqual(calls, ["read_followup_jobs"]);
});

Deno.test("sandbox uses real claim and finish with hello_world and dedicated credentials", async () => {
  const calls: string[] = []; let sends = 0;
  const rpc: FollowupRpc = <T>(name: string, args: Record<string, unknown>) => {
    calls.push(name);
    if (name === "read_followup_jobs") return Promise.resolve([] as T);
    if (name === "read_whatsapp_test_jobs") { assert.deepEqual(args, { p_phone: message.phone }); return Promise.resolve([{ id: message.id }] as T); }
    if (name === "claim_whatsapp_test_job") { assert.deepEqual(args, { p_job_id: message.id, p_phone: message.phone }); return Promise.resolve({ action: "claimed", claimToken: "owned", message: testMessage } as T); }
    assert.equal(name, "finish_followup_job"); assert.equal(args.p_provider_id, "sandbox-sent"); assert.equal(args.p_token, "owned"); return Promise.resolve(true as T);
  };
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).includes("?fields=")) return Response.json({ id: "123", display_phone_number: "+1 555-657-6659" });
    sends++; assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer sandbox-token");
    const payload = JSON.parse(String(init?.body)); assert.equal(payload.to, message.phone.slice(1));
    assert.deepEqual(payload.template, { name: "hello_world", language: { code: "en_US" } }); return Response.json({ messages: [{ id: "sandbox-sent" }] });
  };
  const response = await handleFollowupWorker(request(), testEnv, rpc, fetcher);
  assert.equal(response.status, 200); assert.equal((await response.json()).test.sent, 1); assert.equal(sends, 1);
  assert.deepEqual(calls, ["read_followup_jobs", "read_whatsapp_test_jobs", "claim_whatsapp_test_job", "finish_followup_job"]);
});

Deno.test("sandbox rejects altered recipient, marker and template before sending", async () => {
  const test = loadFollowupConfig(testEnv).whatsappTest!;
  for (const alteration of [{ phone: "+34699999999" }, { testMode: false }, { templateName: "paid_template" }, { parameter: "name" as const }]) {
    assert.deepEqual(await sendFollowup({ ...testMessage, ...alteration }, { email: null, whatsapp: test, whatsappTest: test }, noFetch), { outcome: "failed", error: "sandbox_message_mismatch" });
  }
});

Deno.test("ambiguous sandbox sends finish as unknown without an immediate retry", async () => {
  const test = loadFollowupConfig(testEnv).whatsappTest!; let sends = 0;
  const rpc: FollowupRpc = <T>(name: string, args: Record<string, unknown>) => {
    if (name === "read_whatsapp_test_jobs") return Promise.resolve([{ id: message.id }] as T);
    if (name === "claim_whatsapp_test_job") return Promise.resolve({ action: "claimed", claimToken: "owned", message: testMessage } as T);
    assert.equal(args.p_outcome, "unknown"); return Promise.resolve(true as T);
  };
  const result = await processFollowups(rpc, { email: null, whatsapp: test, whatsappTest: test }, async () => { sends++; throw new Error("timeout"); });
  assert.equal(result.unknown, 1); assert.equal(sends, 1);
});

Deno.test("the Edge SDK rejects missing, public, JWT and old cron credentials before accessing data", async () => {
  const handler = createFollowupHandler(env, noRpc, authEnv);
  for (const token of ["", "user-jwt", "anon-jwt", "old-cron-secret", authEnv.publishableKeys.default]) {
    assert.equal((await handler(request(token))).status, 401);
  }
  assert.equal((await handler(new Request("https://example.com", { method: "POST", headers: { authorization: `Bearer ${authEnv.secretKeys.default}` } }))).status, 401);
  assert.equal((await handler(request(authEnv.secretKeys.default, "GET"))).status, 405);
});

Deno.test("followups require explicit channel activation and complete configuration", async () => {
  assert.deepEqual(loadFollowupConfig({ RESEND_API_KEY: "secret" }), { email: null, whatsapp: null });
  assert.equal(loadFollowupConfig({ ...env, FOLLOWUP_EMAIL_SEND_ENABLED: "false" }).email, null);
  assert.equal(loadFollowupConfig({ ...env, ADMIN_SITE_URL: "http://example.com" }).email, null);
  assert.equal(loadFollowupConfig({ ...env, EMAIL_UNSUBSCRIBE_SECRET: "short" }).email, null);
  assert.equal(loadFollowupConfig({ ...env, RESEND_FROM: "bad\r\nheader" }).email, null);
  assert.equal((await handleFollowupWorker(request(), {}, noRpc, noFetch)).status, 503);
});

Deno.test("Deno sends idempotent personalized emails with the existing HMAC unsubscribe format", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), `followup/${message.id}`);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.template.id, "email-2-casos");
    assert.equal(body.template.variables.LEAD_NAME, "Adrián");
    // Resend rejects template requests combined with raw text or HTML.
    assert.equal(body.text, undefined);
    assert.equal(body.html, undefined);
    assert.deepEqual(body.to, [message.email]);
    assert.equal(body.from, config.email.from);
    assert.equal(body.subject, message.subject);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`email-unsubscribe:${message.registrationId}`)));
    const token = `${message.registrationId}.${Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const link = new URL(body.template.variables.EMAIL_UNSUBSCRIBE_URL);
    assert.equal(link.origin, env.ADMIN_SITE_URL);
    assert.equal(link.pathname, "/api/followups/unsubscribe");
    assert.equal(link.searchParams.get("token"), token);
    return Response.json({ id: "email-provider-id" });
  };
  assert.deepEqual(await sendFollowup(message, config, fetcher), { outcome: "sent", providerId: "email-provider-id" });
});

Deno.test("all four email steps select the published template and supply exactly its required variables", async () => {
  const aliases = ["email-1-claridad", "email-2-casos", "email-3-empezar", "email-4-resultados"];
  for (const [index, alias] of aliases.entries()) {
    const fetcher: typeof fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.template.id, alias);
      assert.deepEqual(Object.keys(payload.template.variables).sort(), index === 1
        ? ["EMAIL_UNSUBSCRIBE_URL", "LEAD_NAME"] : ["EMAIL_UNSUBSCRIBE_URL"]);
      return Response.json({ id: "email-provider-id" });
    };
    assert.equal((await sendFollowup({ ...message, step: `email_${index + 1}` }, config, fetcher)).outcome, "sent");
  }
});

Deno.test("untrusted lead names cannot inject HTML into the case study template", async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.template.variables.LEAD_NAME, "&lt;img src=x&gt; &amp; &quot;Ana&quot; &#39;Roa&#39;");
    return Response.json({ id: "email-provider-id" });
  };
  assert.equal((await sendFollowup({ ...message, name: '<img src=x> & "Ana" \'Roa\'' }, config, fetcher)).outcome, "sent");
});

Deno.test("unknown email steps never send an unintended template", async () => {
  for (const step of ["unknown", "constructor", "__proto__"]) {
    assert.deepEqual(await sendFollowup({ ...message, step }, config, noFetch), { outcome: "failed", error: "email_template_missing" });
  }
});

for (const parameter of [null, "meetingUrl", "time", "name"] as const) {
  Deno.test(`followups preserve WhatsApp template parameter ${parameter}`, async () => {
    const fetcher: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.to, "34612345678");
      if (parameter) assert.equal(body.template.components[0].parameters[0].text, message[parameter]);
      else assert.equal(body.template.components, undefined);
      return Response.json({ messages: [{ id: "wamid.sent" }] });
    };
    assert.equal((await sendFollowup({ ...message, channel: "whatsapp", parameter }, config, fetcher)).outcome, "sent");
  });
}

Deno.test("followups leave timeouts and ambiguous responses for manual review", async () => {
  const fetchers: typeof fetch[] = [async () => { throw new Error("timeout"); }, fetchJson({}), async () => new Response("bad gateway", { status: 502 })];
  for (const fetcher of fetchers) assert.deepEqual(await sendFollowup(message, config, fetcher), { outcome: "unknown", error: "delivery_unknown" });
});

Deno.test("followups retry structured throttling and fail permanent rejections", async () => {
  assert.equal((await sendFollowup(message, config, fetchJson({ name: "rate_limit_exceeded" }, 429))).outcome, "retry");
  assert.equal((await sendFollowup(message, config, fetchJson({ name: "validation_error" }, 422))).outcome, "failed");
  assert.equal((await sendFollowup({ ...message, channel: "whatsapp" }, config, fetchJson({ error: { code: 131000 } }, 500))).outcome, "retry");
});

Deno.test("followups do not send paused or suppressed jobs", async () => {
  const rpc: FollowupRpc = <T>(name: string): Promise<T> => Promise.resolve((name === "read_followup_jobs" ? [{ id: message.id }, { id: "skipped" }] : { action: "skip" }) as T);
  const result = await processFollowups(rpc, config, noFetch);
  assert.equal(result.skipped, 2); assert.equal(result.sent, 0);
});

Deno.test("followups persist the result with the owned claim and provider ID", async () => {
  const calls: string[] = [];
  const rpc: FollowupRpc = <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    calls.push(name);
    if (name === "read_followup_jobs") assert.deepEqual(args, { p_email: true, p_whatsapp: true });
    if (name === "finish_followup_job") assert.deepEqual(args, { p_id: message.id, p_token: "token", p_outcome: "sent", p_provider_id: "sent", p_error: null });
    return Promise.resolve((name === "read_followup_jobs" ? [{ id: message.id }] : name === "claim_followup_job" ? { action: "claimed", claimToken: "token", message } : true) as T);
  };
  assert.equal((await processFollowups(rpc, config, fetchJson({ id: "sent" }))).sent, 1);
  assert.deepEqual(calls, ["read_followup_jobs", "claim_followup_job", "finish_followup_job"]);
});

Deno.test("a database error after sending never causes an immediate duplicate send", async () => {
  let sends = 0;
  const rpc: FollowupRpc = <T>(name: string): Promise<T> => {
    if (name === "finish_followup_job") throw new Error("Database unavailable");
    return Promise.resolve((name === "read_followup_jobs" ? [{ id: message.id }] : { action: "claimed", claimToken: "token", message }) as T);
  };
  const result = await processFollowups(rpc, config, async () => { sends++; return Response.json({ id: "sent" }); });
  assert.equal(result.errors, 1); assert.equal(sends, 1);
});

Deno.test("an authenticated Edge Function processes an empty queue without sending", async () => {
  const rpc: FollowupRpc = <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    assert.equal(name, "read_followup_jobs"); assert.deepEqual(args, { p_email: true, p_whatsapp: false });
    return Promise.resolve([] as T);
  };
  const response = await createFollowupHandler(env, rpc, authEnv)(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { read: 0, sent: 0, retry: 0, failed: 0, unknown: 0, skipped: 0, errors: 0 });
});
