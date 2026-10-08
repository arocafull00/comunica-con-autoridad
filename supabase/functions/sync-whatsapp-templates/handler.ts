import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { fetchTemplates } from "../_shared/meta-templates.ts";

export function createTemplateSyncHandler(env: Record<string, string | undefined>, fetcher: typeof fetch = fetch) {
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
      // Verify the caller with Auth, then recheck membership so revocations take effect immediately.
      const { data: { user }, error } = await db.auth.getUser(authorization.slice(7));
      if (error || !user) return json(401, { error: "unauthorized" });
      const membership = await db.from("admin_accounts").select("active").eq("user_id", user.id).maybeSingle();
      if (membership.error) return json(503, { error: "authorization_unavailable" });
      if (!membership.data?.active) return json(403, { error: "forbidden" });
    } catch { return json(503, { error: "authorization_unavailable" }); }
    const token = env.WHATSAPP_ACCESS_TOKEN;
    const wabaId = env.WHATSAPP_WABA_ID;
    const version = env.WHATSAPP_GRAPH_API_VERSION;
    if (!token || !/^\d+$/.test(wabaId ?? "") || !/^v\d+\.\d+$/.test(version ?? "")) return json(503, { error: "sync_not_configured" });
    let templates;
    try {
      templates = await fetchTemplates({ token, wabaId: wabaId!, version: version! }, fetcher);
    } catch { return json(502, { error: "meta_catalog_unavailable" }); }
    try {
      // Only write after the complete catalog was fetched. The existing RPC is transactional.
      const { error } = await db.rpc("sync_whatsapp_templates", { p_templates: templates });
      if (error) return json(503, { error: "catalog_save_failed" });
    } catch { return json(503, { error: "catalog_save_failed" }); }
    return json(200, { count: templates.length });
  };
}
