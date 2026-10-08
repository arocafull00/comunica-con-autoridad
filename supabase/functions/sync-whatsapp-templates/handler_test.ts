import assert from "node:assert/strict";
import { createTemplateSyncHandler } from "./handler.ts";

const userId = "00000000-0000-4000-8000-000000000001";
const env = { SUPABASE_URL: "https://db.example.com", SUPABASE_SERVICE_ROLE_KEY: "private-db-key", WHATSAPP_ACCESS_TOKEN: "private-meta-token", WHATSAPP_WABA_ID: "123", WHATSAPP_GRAPH_API_VERSION: "v25.0" };
const template = { name: "welcome", language: "es", status: "APPROVED", components: [{ type: "BODY", text: "Hola {{1}}, recibimos tu solicitud." }] };
const request = (token = "user-token", method = "POST") => new Request("https://db.example.com/functions/v1/sync-whatsapp-templates", { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

function fixture({ active = true, invalidUser = false, metaFailure = false, saveFailure = false, empty = false, failLaterPage = false } = {}) {
  const writes: unknown[] = [];
  let metaCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer user-token");
      return invalidUser ? Response.json({ message: "invalid" }, { status: 401 }) : Response.json({ id: userId });
    }
    if (url.pathname === "/rest/v1/admin_accounts") {
      assert.equal(url.searchParams.get("user_id"), `eq.${userId}`);
      return Response.json([{ active }]);
    }
    if (url.origin === "https://graph.facebook.com") {
      metaCalls++;
      assert.equal(url.pathname, "/v25.0/123/message_templates");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-meta-token");
      assert.equal(init?.method ?? "GET", "GET");
      assert.equal(url.searchParams.has("access_token"), false);
      if (metaFailure || (failLaterPage && metaCalls === 2)) return Response.json({ error: "private-meta-token" }, { status: 403 });
      if (metaCalls === 1) return Response.json({ data: [], paging: { next: "https://attacker.invalid", cursors: { after: "cursor" } } });
      assert.equal(url.searchParams.get("after"), "cursor");
      return Response.json({ data: empty ? [] : [template, { ...template, status: "PENDING" }, { ...template, components: [...template.components, { type: "HEADER" }] }] });
    }
    assert.equal(url.pathname, "/rest/v1/rpc/sync_whatsapp_templates");
    assert.equal(init?.method, "POST");
    writes.push(JSON.parse(String(init?.body)));
    return saveFailure ? Response.json({ message: "private-db-key" }, { status: 500 }) : new Response(null, { status: 204 });
  };
  return { handler: createTemplateSyncHandler(env, fetcher), writes, metaCalls: () => metaCalls };
}

Deno.test("catalog sync rejects anonymous, invalid and revoked users before contacting Meta", async () => {
  const unauthenticated = fixture();
  assert.equal((await unauthenticated.handler(request(""))).status, 401);
  assert.equal((await unauthenticated.handler(request("user-token", "GET"))).status, 405);
  for (const options of [{ invalidUser: true }, { active: false }]) {
    const test = fixture(options);
    assert.equal((await test.handler(request())).status, options.invalidUser ? 401 : 403);
    assert.equal(test.metaCalls(), 0);
    assert.equal(test.writes.length, 0);
  }
});

Deno.test("catalog sync paginates against Meta and atomically stores only compatible templates", async () => {
  const test = fixture();
  const response = await test.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { count: 1 });
  assert.deepEqual(test.writes, [{ p_templates: [{ name: template.name, language: template.language, body: template.components[0].text }] }]);
});

Deno.test("failed initial or later Meta pages leave the catalog intact and do not leak credentials", async () => {
  for (const options of [{ metaFailure: true }, { failLaterPage: true }]) {
    const test = fixture(options);
    const response = await test.handler(request());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "meta_catalog_unavailable" });
    assert.equal(test.writes.length, 0);
  }
});

Deno.test("a valid empty catalog revokes stale templates through the same RPC", async () => {
  const test = fixture({ empty: true });
  assert.deepEqual(await (await test.handler(request())).json(), { count: 0 });
  assert.deepEqual(test.writes, [{ p_templates: [] }]);
});

Deno.test("database errors do not report a successful sync or expose provider errors", async () => {
  const test = fixture({ saveFailure: true });
  const response = await test.handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "catalog_save_failed" });
});

Deno.test("missing Meta configuration fails after authorization without writing", async () => {
  const test = fixture();
  const handler = createTemplateSyncHandler({ ...env, WHATSAPP_WABA_ID: undefined }, async (input) => {
    return String(input).includes("/auth/") ? Response.json({ id: userId }) : Response.json([{ active: true }]);
  });
  assert.equal((await handler(request())).status, 503);
  assert.equal(test.writes.length, 0);
});
