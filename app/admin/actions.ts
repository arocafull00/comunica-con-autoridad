"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseSession } from "@/lib/supabase/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/auth";
import { loginSchema, passwordSchema, tokenHashSchema } from "@/lib/admin/validation";
import { requestIpHash } from "@/lib/leads/request";

export type ActionState = { message: string; success?: boolean };
export async function login(_previous: ActionState, form: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: String(form.get("email") ?? "").trim(), password: form.get("password") });
  if (!parsed.success) return { message: "Introduce un email y una contraseña válidos." };
  let permitted = false;
  try {
    const hash = requestIpHash(new Request("http://internal", { headers: await headers() }), { LEAD_IP_HMAC_SECRET: process.env.LEAD_IP_HMAC_SECRET, VERCEL: process.env.VERCEL });
    const db = getSupabaseAdmin();
    const limit = await db.rpc("allow_admin_login", { p_ip_hash: hash });
    if (limit.error) throw limit.error;
    if (!limit.data) return { message: "Demasiados intentos. Espera diez minutos y vuelve a intentarlo." };
    const session = await getSupabaseSession();
    const { data, error } = await session.auth.signInWithPassword(parsed.data);
    if (!error && data.user) {
      const membership = await db.from("admin_accounts").select("active").eq("user_id", data.user.id).maybeSingle();
      if (membership.error) throw membership.error;
      permitted = !!membership.data?.active;
      if (!permitted) await session.auth.signOut();
    }
  } catch { return { message: "No se pudo iniciar sesión. Inténtalo de nuevo." }; }
  if (!permitted) return { message: "No se pudo acceder con estas credenciales." };
  redirect("/admin");
}
export async function logout() {
  const session = await getSupabaseSession();
  await session.auth.signOut();
  redirect("/admin/login");
}
export async function acceptInvitation(_previous: ActionState, form: FormData): Promise<ActionState> {
  const password = passwordSchema.safeParse(form.get("password"));
  const tokenHash = String(form.get("tokenHash") ?? "");
  const type = form.get("type");
  if (!password.success) return { message: "Usa una contraseña de entre 12 y 128 caracteres." };
  if (password.data !== form.get("confirmation")) return { message: "Las contraseñas no coinciden." };
  if (!tokenHashSchema.safeParse(tokenHash).success || (type !== "invite" && type !== "recovery")) return { message: "El enlace no es válido. Solicita uno nuevo al responsable de la web." };
  try {
    const session = await getSupabaseSession();
    const verified = await session.auth.verifyOtp({ token_hash: tokenHash, type });
    if (verified.error || !verified.data.user) return { message: "El enlace ha caducado o ya se ha usado. Solicita uno nuevo." };
    const db = getSupabaseAdmin();
    const account = await db.from("admin_accounts").select("active").eq("user_id", verified.data.user.id).maybeSingle();
    if (account.error || !account.data?.active) { await session.auth.signOut(); return { message: "Esta cuenta no tiene acceso de administrador." }; }
    const updated = await session.auth.updateUser({ password: password.data });
    await session.auth.signOut();
    if (updated.error) return { message: "No se pudo establecer la contraseña. Solicita un nuevo enlace." };
  } catch { return { message: "No se pudo completar el acceso. Solicita un nuevo enlace si el anterior ya se consumió." }; }
  redirect("/admin/login?ready=1");
}
export async function changePassword(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { session, user } = await requireAdmin();
  const password = passwordSchema.safeParse(form.get("password"));
  const current = String(form.get("currentPassword") ?? "");
  if (!password.success || current.length < 1 || current.length > 128) return { message: "Usa una contraseña nueva de entre 12 y 128 caracteres." };
  if (password.data !== form.get("confirmation")) return { message: "Las contraseñas no coinciden." };
  try {
    const check = await session.auth.signInWithPassword({ email: user.email!, password: current });
    if (check.error) return { message: "La contraseña actual no es correcta." };
    const updated = await session.auth.updateUser({ password: password.data });
    if (updated.error) return { message: "No se pudo cambiar la contraseña." };
    return { message: "Contraseña actualizada.", success: true };
  } catch { return { message: "No se pudo cambiar la contraseña. Inténtalo de nuevo." }; }
}
