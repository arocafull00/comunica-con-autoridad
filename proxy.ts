import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfiguration, authCookieOptions } from "@/lib/supabase/session";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    const { url, key } = authConfiguration();
    const supabase = createServerClient(url, key, {
      cookieOptions: authCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
    });
    // Page and Action guards also verify the user and fresh database membership.
    await supabase.auth.getUser();
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
export const config = { matcher: ["/admin/:path*"] };
