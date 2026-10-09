import assert from "node:assert/strict";
import { createTemplateVersionHandler } from "./handler.ts";
const sourceId = "00000000-0000-4000-8000-000000000001";
const env = { SUPABASE_URL: "https://db.example.com", SUPABASE_SERVICE_ROLE_KEY: "private-db-key", WHATSAPP_ACCESS_TOKEN: "private-meta-token", WHATSAPP_WABA_ID: "123", WHATSAPP_GRAPH_API_VERSION: "v25.0" };
const source = { id: "111", name: "welcome_v1", language: "es", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}}, bienvenida." }] };
const input = { sourceId, name: "welcome_v2", body: "Gracias {{1}}, hemos recibido tu solicitud." };
const request = (data: unknown = input, token = "user-token", method = "POST") => new Request("https://db.example.com/functions/v1/create-whatsapp-template-version", { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: method === "POST" ? JSON.stringify(data) : undefined });
function fixture({ active = true, invalidUser = false, catalogFailure = false, createFailure = 0, createTimeout = false, saveFailure = false, status = "PENDING", existing = false, unsupported = false } = {}) {
  const posts: object[] = []; const writes: object[] = []; let metaReads = 0;
  const fetcher: typeof fetch = async (urlInput, init) => {
    const url = new URL(String(urlInput));
    if (url.pathname === "/auth/v1/user") {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer user-token");
      return invalidUser ? Response.json({ error: "invalid" }, { status: 401 }) : Response.json({ id: sourceId });
    }
    if (url.pathname === "/rest/v1/admin_accounts") return Response.json([{ active }]);
    if (url.pathname === "/rest/v1/whatsapp_templates" && (init?.method ?? "GET") === "GET") {
      assert.equal(url.searchParams.get("id"), `eq.${sourceId}`);
      return Response.json({ name: source.name, language: source.language });
    }
    if (url.origin === "https://graph.facebook.com") {
      assert.equal(url.pathname, "/v25.0/123/message_templates"); // Never edits /111 or sends /messages.
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-meta-token");
      assert.equal(url.searchParams.has("access_token"), false);
      if ((init?.method ?? "GET") === "GET") {
        metaReads++;
        return catalogFailure ? Response.json({}, { status: 500 }) : Response.json({ data: [unsupported ? { ...source, components: [...source.components, { type: "HEADER" }] } : source, ...(existing ? [{ ...source, name: input.name }] : [])] });
      }
      assert.equal(init?.method, "POST");
      posts.push(JSON.parse(String(init?.body)));
      if (createTimeout) throw new Error("private-meta-token");
      return createFailure ? Response.json({ error: "private-meta-token" }, { status: createFailure }) : Response.json({ id: "222", status, category: "UTILITY" });
    }
    assert.equal(url.pathname, "/rest/v1/whatsapp_templates");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Prefer")?.includes("ignore-duplicates"), true);
    writes.push(JSON.parse(String(init?.body)));
    return saveFailure ? Response.json({ error: "private-db-key" }, { status: 500 }) : new Response(null, { status: 201 });
  };
  return { handler: createTemplateVersionHandler(env, fetcher), posts, writes, reads: () => metaReads };
}
Deno.test("new versions require verified active admin access before reading or contacting Meta", async () => {
  for (const [options, req, expected] of [[{}, request(input, ""), 401], [{ active: false }, request(), 403], [{ invalidUser: true }, request(), 401], [{}, request(input, "user-token", "GET"), 405]] as const) {
    const test = fixture(options);
    assert.equal((await test.handler(req)).status, expected);
    assert.equal(test.reads(), 0); assert.equal(test.posts.length, 0); assert.equal(test.writes.length, 0);
  }
});
Deno.test("creates a separately named Meta template preserving category/language and the original selection", async () => {
  const test = fixture(); const response = await test.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { name: "welcome_v2", status: "PENDING", stored: true });
  assert.deepEqual(test.posts, [{ name: input.name, language: "es", category: "UTILITY", parameter_format: "POSITIONAL", components: [{ type: "BODY", text: input.body, example: { body_text: [["María"]] } }] }]);
  assert.equal(test.writes.length, 1);
  assert.equal((test.writes[0] as Record<string, unknown>).approved, false);
  assert.equal((test.writes[0] as Record<string, unknown>).version_of, sourceId);
  assert.equal((test.writes[0] as Record<string, unknown>).name, input.name);
});
Deno.test("invalid inputs, duplicate names, unchanged bodies and unsupported components never issue a creation POST", async () => {
  for (const [options, data, expected] of [[{}, { ...input, name: "BAD" }, 400], [{}, { ...input, body: "Hola {{1}} {{2}}" }, 400], [{ existing: true }, input, 409], [{}, { ...input, body: source.components[0].text }, 400], [{ unsupported: true }, input, 400], [{ catalogFailure: true }, input, 502]] as const) {
    const test = fixture(options);
    assert.equal((await test.handler(request(data))).status, expected);
    assert.equal(test.posts.length, 0); assert.equal(test.writes.length, 0);
  }
});
Deno.test("creation errors do not retry an uncertain POST or expose credentials", async () => {
  for (const [options, error] of [[{ createTimeout: true }, "create_unknown"], [{ createFailure: 500 }, "create_unknown"], [{ createFailure: 400 }, "meta_create_rejected"]] as const) {
    const test = fixture(options); const response = await test.handler(request());
    assert.deepEqual(await response.json(), { error });
    assert.equal(test.posts.length, 1); assert.equal(test.writes.length, 0);
  }
});
Deno.test("accepted creation survives a local save failure and tells the dashboard to synchronize", async () => {
  const test = fixture({ saveFailure: true }); const response = await test.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { name: input.name, status: "PENDING", stored: false });
  assert.equal(test.posts.length, 1);
});
Deno.test("immediately approved new templates remain separate and are eligible only for manual selection", async () => {
  const test = fixture({ status: "APPROVED" });
  assert.equal((await test.handler(request())).status, 200);
  assert.equal((test.writes[0] as Record<string, unknown>).approved, true);
});
