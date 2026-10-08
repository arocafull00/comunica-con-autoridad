import { handleCalWebhook } from "@/lib/followups/cal";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(request: Request) {
  return handleCalWebhook(request, {
    secret: process.env.CAL_WEBHOOK_SECRET, eventSlug: process.env.CAL_EVENT_SLUG,
    save: async (event) => {
      const { data, error } = await getSupabaseAdmin().rpc("record_cal_booking", { p_event: event });
      if (error) throw new Error("Booking persistence failed");
      return data;
    },
  });
}
