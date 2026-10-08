import "server-only";
import { cache } from "react";
import { cacheLife } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseSession } from "@/lib/supabase/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Deduplicate layout/page checks in one render; never retain permissions between requests.
export const requireAdmin = cache(async function requireAdmin() {
  const session = await getSupabaseSession();
  const { data: { user }, error } = await session.auth.getUser();
  if (error || !user) redirect("/admin/login");
  const db = getSupabaseAdmin();
  const membership = await db.from("admin_accounts").select("active").eq("user_id", user.id).maybeSingle();
  if (membership.error) throw new Error("No se pudo comprobar el acceso. Inténtalo de nuevo.");
  if (!membership.data?.active) redirect("/admin/login?denied=1");
  return { user, db, session };
});

export async function getAdminIdentity() {
  "use cache: private";
  cacheLife({ stale: 60 });
  const { user } = await requireAdmin();
  return { email: user.email };
}
