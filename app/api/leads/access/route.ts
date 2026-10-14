import { handleBookingForm } from "@/lib/leads/booking-handler";
import { saveLeadToGoogleSheets } from "@/lib/leads/google-sheets";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { verifyAccessToken } from "@/lib/leads/access-token";

export async function GET(request: Request) {
  const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const id = verifyAccessToken(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", process.env.LEAD_IP_HMAC_SECRET ?? "");
    if (!id) return json(401, { ok: false });
    const db = getSupabaseAdmin();
    const lead = await db.from("leads").select("email").eq("idempotency_key", id).maybeSingle();
    if (lead.error) throw lead.error;
    if (!lead.data) return json(401, { ok: false });
    const registration = await db.from("webinar_registrations").select("id").eq("email", lead.data.email).maybeSingle();
    if (registration.error) throw registration.error;
    return json(registration.data ? 200 : 401, { ok: !!registration.data });
  } catch {
    return json(503, { ok: false });
  }
}

export async function POST(request: Request) {
  return handleBookingForm(request, "access", {
    env: { VERCEL: process.env.VERCEL, LEAD_IP_HMAC_SECRET: process.env.LEAD_IP_HMAC_SECRET },
    syncSheets: saveLeadToGoogleSheets,
    persist: async (args, variant) => {
      const rpc = variant === "contact" ? "submit_masterclass_contact" : "submit_masterclass_email_access";
      const { data, error } = await getSupabaseAdmin().rpc(rpc, args);
      if (error || !data) throw new Error("Access persistence failed");
      return data;
    },
    registerWebinar: async id => {
      const { error } = await getSupabaseAdmin().rpc("register_webinar", { p_submission_id: id });
      if (error) throw new Error("Webinar registration failed");
    },
  });
}
