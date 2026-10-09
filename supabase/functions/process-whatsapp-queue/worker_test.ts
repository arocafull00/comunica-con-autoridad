import assert from "node:assert/strict";
import { authorized, loadConfig, processQueue, sendWelcome, type Rpc, type WorkerConfig } from "./worker.ts";

const config: WorkerConfig = { accessToken: "test-token", phoneNumberId: "123456", graphApiVersion: "v99.0" };
const claim = { action: "claimed" as const, message_id: "message-id", claim_token: "claim-token", name: "Adrián", phone: "+34612345678", template_name: "welcome", template_language: "es", graph_api_version: "v99.0" };
const fetchJson = (body: object, status = 200): typeof fetch => async () => Response.json(body, { status });

Deno.test("worker authorization rejects missing/user tokens", async () => {
  assert.equal(await authorized(new Request("http://localhost"), "service-jwt"), false);
  assert.equal(await authorized(new Request("http://localhost", { headers: { authorization: "Bearer user-jwt" } }), "service-jwt"), false);
  assert.equal(await authorized(new Request("http://localhost", { headers: { authorization: "Bearer service-jwt" } }), "service-jwt"), true);
});
Deno.test("worker is disabled unless enabled and fully configured", () => {
  assert.equal(loadConfig(() => undefined), null);
  assert.equal(loadConfig((name) => name === "WHATSAPP_SEND_ENABLED" ? "true" : undefined), null);
});

Deno.test("contacts captured without a name send a neutral greeting", async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.template.components[0].parameters[0].text, "comunicador/a");
    return Response.json({ messages: [{ id: "wamid.sent" }] });
  };
  assert.equal((await sendWelcome({ ...claim, name: null }, config, fetcher)).outcome, "sent");
});
Deno.test("dashboard pause skips sends and template configuration is read atomically from Postgres", async () => {
  assert.ok(loadConfig((name) => ({ WHATSAPP_SEND_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "test", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_GRAPH_API_VERSION: "v99.0" })[name]));
  const rpc: Rpc = <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
    if (name === "read_whatsapp_jobs") return Promise.resolve([{ queue_id: "1" }] as T);
    assert.equal(name, "claim_configured_whatsapp_job");
    assert.deepEqual(args, { p_queue_id: "1", p_graph_api_version: "v99.0" });
    return Promise.resolve({ action: "paused" } as T);
  };
  const counts = await processQueue(rpc, config, async () => { throw new Error("Must not send while paused"); });
  assert.equal(counts.skipped, 1); assert.equal(counts.errors, 0);
});
Deno.test("template payload, timeout signal and provider id", async () => {
  const result = await sendWelcome(claim, config, async (input, init) => {
    assert.equal(input, "https://graph.facebook.com/v99.0/123456/messages");
    assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.to, "34612345678");
    assert.equal(body.template.components[0].parameters[0].text, "Adrián");
    return Response.json({ messages: [{ id: "wamid.test" }] });
  });
  assert.deepEqual(result, { outcome: "sent", providerId: "wamid.test" });
});
Deno.test("confirmed transient Meta rejection retries", async () => {
  assert.deepEqual(await sendWelcome(claim, config, fetchJson({ error: { code: 130429 } }, 429)), { outcome: "retry", error: "meta_130429_http_429" });
  assert.equal((await sendWelcome(claim, config, fetchJson({ error: { code: 131000, is_transient: true } }, 500))).outcome, "retry");
});
Deno.test("fixed text templates omit all dynamic parameters", async () => {
  const result = await sendWelcome({ ...claim, template_parameter_count: 0 }, config, async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.template, { name: "welcome", language: { code: "es" } });
    return Response.json({ messages: [{ id: "wamid.fixed" }] });
  });
  assert.deepEqual(result, { outcome: "sent", providerId: "wamid.fixed" });
});
Deno.test("permanent Meta rejection fails without exposing provider messages", async () => {
  assert.deepEqual(await sendWelcome(claim, config, fetchJson({ error: { code: 132001, message: "private detail" } }, 400)), { outcome: "failed", error: "meta_132001_http_400" });
});
Deno.test("timeouts, invalid responses and missing provider ids are uncertain", async () => {
  assert.equal((await sendWelcome(claim, config, async () => { throw new DOMException("timeout", "TimeoutError"); })).outcome, "unknown");
  assert.equal((await sendWelcome(claim, config, async () => new Response("bad gateway", { status: 502 }))).outcome, "unknown");
  assert.equal((await sendWelcome(claim, config, fetchJson({}))).outcome, "unknown");
});
Deno.test("queue skips completed/duplicate/stale jobs without sending", async () => {
  let sends = 0;
  const rpc: Rpc = <T>(name: string, args?: Record<string, unknown>): Promise<T> => Promise.resolve((name === "read_whatsapp_jobs"
    ? [{ queue_id: "1" }, { queue_id: "2" }, { queue_id: "3" }]
    : { action: args?.p_queue_id === "3" ? "unknown" : "skip" }) as T);
  const counts = await processQueue(rpc, config, async () => { sends++; return Response.json({}); });
  assert.equal(sends, 0);
  assert.equal(counts.skipped, 2);
  assert.equal(counts.unknown, 1);
});
Deno.test("ten jobs use at most two concurrent provider requests", async () => {
  let active = 0;
  let peak = 0;
  const finishes: Record<string, unknown>[] = [];
  const rpc: Rpc = <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
    if (name === "read_whatsapp_jobs") return Promise.resolve(Array.from({ length: 10 }, (_, i) => ({ queue_id: String(i) })) as T);
    if (name === "claim_configured_whatsapp_job") return Promise.resolve(claim as T);
    finishes.push(args!);
    return Promise.resolve(true as T);
  };
  const counts = await processQueue(rpc, config, async () => {
    active++; peak = Math.max(active, peak);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return Response.json({ messages: [{ id: "wamid.test" }] });
  });
  assert.equal(peak, 2);
  assert.equal(counts.sent, 10);
  assert.equal(finishes.length, 10);
});
Deno.test("a persistence failure after sending never causes an immediate resend", async () => {
  let sends = 0;
  const rpc: Rpc = <T>(name: string): Promise<T> => {
    if (name === "read_whatsapp_jobs") return Promise.resolve([{ queue_id: "1" }] as T);
    if (name === "claim_configured_whatsapp_job") return Promise.resolve(claim as T);
    return Promise.reject(new Error("database interrupted"));
  };
  const counts = await processQueue(rpc, config, async () => { sends++; return Response.json({ messages: [{ id: "wamid.test" }] }); });
  assert.equal(sends, 1);
  assert.equal(counts.errors, 1);
});
