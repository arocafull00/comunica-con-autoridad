import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { fetchTemplates } from "../_shared/meta-templates.ts";
import { validVersionInput, validWelcomeBody } from "../../../lib/whatsapp-template-version.ts";

export function createTemplateVersionHandler(env: Record<string, string | undefined>, fetcher: typeof fetch = fetch) {
  return async (request: Request) => {
    const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ") || !authorization.slice(7)) return json(401, { error: "unauthorized" });
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json(503, { error: "sync_not_configured" });
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetcher(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
    });
    try {
      const { data: { user }, error } = await db.auth.getUser(authorization.slice(7));
      if (error || !user) return json(401, { error: "unauthorized" });
      const membership = await db.from("admin_accounts").select("active").eq("user_id", user.id).maybeSingle();
      if (membership.error) return json(503, { error: "authorization_unavailable" });
      if (!membership.data?.active) return json(403, { error: "forbidden" });
    } catch { return json(503, { error: "authorization_unavailable" }); }
    let input;
    try {
      if (Number(request.headers.get("content-length")) > 16_384) return json(400, { error: "invalid_version" });
      const body = await request.text();
      if (body.length > 16_384) return json(400, { error: "invalid_version" });
      input = JSON.parse(body);
    } catch { return json(400, { error: "invalid_version" }); }
    if (!validVersionInput(input)) return json(400, { error: "invalid_version" });
    const token = env.WHATSAPP_ACCESS_TOKEN; const wabaId = env.WHATSAPP_WABA_ID; const version = env.WHATSAPP_GRAPH_API_VERSION;
    if (!token || !/^\d+$/.test(wabaId ?? "") || !/^v\d+\.\d+$/.test(version ?? "")) return json(503, { error: "sync_not_configured" });
    let source;
    try {
      const result = await db.from("whatsapp_templates").select("name,language").eq("id", input.sourceId).maybeSingle();
      if (result.error) return json(503, { error: "catalog_unavailable" });
      if (!result.data) return json(404, { error: "source_unavailable" });
      const identity = result.data;
      const catalog = await fetchTemplates({ token, wabaId: wabaId!, version: version! }, fetcher);
      source = catalog.find((t) => t.name === identity.name && t.language === identity.language);
      if (!source) return json(404, { error: "source_unavailable" });
      // Check Meta's fresh data. Never drop headers, media, buttons or authentication rules.
      if (!["UTILITY", "MARKETING"].includes(source.category) || source.components.length !== 1 ||
        source.components[0]?.type !== "BODY" || !validWelcomeBody(source.body)) return json(400, { error: "unsupported_source" });
      if (catalog.some((t) => t.name === input.name)) return json(409, { error: "version_name_exists" });
      if (input.body === source.body) return json(400, { error: "body_unchanged" });
    } catch { return json(502, { error: "meta_catalog_unavailable" }); }
    const components = [{ type: "BODY", text: input.body, example: { body_text: [["María"]] } }];
    let result;
    try {
      // A NEW named template only. Do not POST to an existing template ID, and never retry an uncertain POST.
      const response = await fetcher(`https://graph.facebook.com/${version}/${wabaId}/message_templates`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.name, language: source.language, category: source.category, parameter_format: "POSITIONAL", components }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return json(response.status >= 500 ? 502 : 400, { error: response.status >= 500 ? "create_unknown" : "meta_create_rejected" });
      result = await response.json();
      if (typeof result.id !== "string" || !/^\d+$/.test(result.id) || !/^[A-Z_]{1,64}$/.test(result.status ?? "")) return json(502, { error: "create_unknown" });
    } catch { return json(502, { error: "create_unknown" }); }
    let stored = false;
    try {
      const saved = await db.from("whatsapp_templates").upsert({ name: input.name, language: source.language, body: input.body,
        meta_status: result.status, approved: result.status === "APPROVED", components,
        category: ["UTILITY", "MARKETING"].includes(result.category) ? result.category : source.category,
        meta_id: result.id, version_of: input.sourceId, verified_at: new Date().toISOString(),
      }, { onConflict: "name,language", ignoreDuplicates: true });
      stored = !saved.error;
    } catch { /* Meta accepted it. A manual sync can recover the catalog entry without another POST. */ }
    return json(200, { name: input.name, status: result.status, stored });
  };
}
