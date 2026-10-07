import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { authorized, loadConfig, processQueue, type Rpc } from "./worker.ts";

Deno.serve(async (request: Request) => {
  const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // The gateway also verifies the JWT (config.toml). A normal authenticated user's JWT is insufficient.
  if (!await authorized(request, serviceKey)) return json(401, { error: "unauthorized" });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const config = loadConfig((name) => Deno.env.get(name));
  if (!config) return json(503, { error: "whatsapp_not_configured_or_disabled" });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
    });
    const rpc: Rpc = async <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
      const { data, error } = await supabase.rpc(name, args);
      if (error || data === null) throw new Error("Queue operation failed");
      return data as T;
    };
    const counts = await processQueue(rpc, config);
    console.log(JSON.stringify({ event: "whatsapp_queue_processed", ...counts }));
    return json(counts.errors ? 500 : 200, counts);
  } catch {
    console.error("whatsapp_queue_unavailable");
    return json(503, { error: "queue_unavailable" });
  }
});
