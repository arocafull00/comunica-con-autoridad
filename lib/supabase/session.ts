import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function authConfiguration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing server Auth configuration");
  return { url, key };
}
export const authCookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" && process.env.ADMIN_LOCAL_HTTP !== "true", path: "/admin" };
export async function getSupabaseSession() {
  const store = await cookies();
  const { url, key } = authConfiguration();
  return createServerClient(url, key, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        // Proxy refreshes cookies during rendering; Actions can write them directly.
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* read-only render */ }
      },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(10_000) }) },
  });
}
