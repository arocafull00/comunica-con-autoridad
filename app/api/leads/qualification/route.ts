import { handleBookingForm } from "@/lib/leads/booking-handler";
import { saveLeadToGoogleSheets } from "@/lib/leads/google-sheets";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(request: Request) {
  return handleBookingForm(request, "qualification", {
    env: { LEAD_IP_HMAC_SECRET: process.env.LEAD_IP_HMAC_SECRET },
    syncSheets: saveLeadToGoogleSheets,
    persist: async args => {
      const { data, error } = await getSupabaseAdmin().rpc("complete_masterclass_qualification", args);
      if (error || !data) throw new Error("Qualification persistence failed");
      return data;
    },
  });
}
