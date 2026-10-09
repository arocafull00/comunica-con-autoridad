import { handleBookingForm } from "@/lib/leads/booking-handler";
import { saveLeadToGoogleSheets } from "@/lib/leads/google-sheets";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(request: Request) {
  return handleBookingForm(request, "access", {
    env: { VERCEL: process.env.VERCEL, LEAD_IP_HMAC_SECRET: process.env.LEAD_IP_HMAC_SECRET },
    syncSheets: saveLeadToGoogleSheets,
    persist: async args => {
      const { data, error } = await getSupabaseAdmin().rpc("submit_masterclass_access", args);
      if (error || !data) throw new Error("Access persistence failed");
      return data;
    },
    registerWebinar: async id => {
      const { error } = await getSupabaseAdmin().rpc("register_webinar", { p_submission_id: id });
      if (error) throw new Error("Webinar registration failed");
    },
  });
}
