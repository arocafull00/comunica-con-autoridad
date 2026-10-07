import "server-only";
import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server configuration");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" }) },
  });
}
