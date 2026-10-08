import assert from "node:assert/strict";
import { createWhatsappTestHandler } from "./handler.ts";

const auth = { url: "https://example.com", secretKeys: { default: "sb_secret_test_private_key" }, publishableKeys: { default: "sb_publishable_test_key" }, jwks: { keys: [] } };
const env = { WHATSAPP_TEST_ACCESS_TOKEN: "meta-test-token", WHATSAPP_TEST_PHONE_NUMBER_ID: "123", WHATSAPP_TEST_GRAPH_API_VERSION: "v25.0", WHATSAPP_TEST_RECIPIENT: "+34612345678" };
const request = (key = auth.secretKeys.default, method = "POST") => new Request("https://example.com", { method, headers: { apikey: key }, ...(method === "POST" ? { body: JSON.stringify({ to: "+34999999999" }) } : {}) });

Deno.test("test sending rejects public credentials before contacting Meta", async () => {
  const handler = createWhatsappTestHandler(env, () => { throw new Error("Must not call Meta"); }, auth);
  for (const key of ["", "user-jwt", auth.publishableKeys.default]) assert.equal((await handler(request(key))).status, 401);
  assert.equal((await handler(request(auth.secretKeys.default, "GET"))).status, 405);
});

Deno.test("test sending cannot use a real business number", async () => {
  let calls = 0;
  const handler = createWhatsappTestHandler(env, async () => { calls++; return Response.json({ id: "123", display_phone_number: "+34612345678" }); }, auth);
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal(calls, 1);
});

Deno.test("test sends only hello_world to the configured recipient, ignoring input destinations", async () => {
  let sends = 0;
  const handler = createWhatsappTestHandler(env, async (url, init) => {
    if (!init?.method) return Response.json({ id: "123", display_phone_number: "+1 555-657-6659" });
    sends++;
    assert.equal(url, "https://graph.facebook.com/v25.0/123/messages");
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.to, "34612345678");
    assert.deepEqual(payload.template, { name: "hello_world", language: { code: "en_US" } });
    return Response.json({ messages: [{ id: "meta-id" }] });
  }, auth);
  assert.equal((await handler(request())).status, 200);
  assert.equal(sends, 1);
});

Deno.test("ambiguous test sends are reported without an automatic resend", async () => {
  let sends = 0;
  const handler = createWhatsappTestHandler(env, async (_url, init) => {
    if (!init?.method) return Response.json({ id: "123", display_phone_number: "+1 555-657-6659" });
    sends++; throw new Error("Timeout");
  }, auth);
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { outcome: "unknown", error: "delivery_unknown" });
  assert.equal(sends, 1);
});
