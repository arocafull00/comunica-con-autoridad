import { handleLeadRequest } from "@/lib/leads/handler";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { saveLeadToGoogleSheets } from "@/lib/leads/google-sheets";

export async function POST(request: Request) {
  return handleLeadRequest(request, {
    env: { VERCEL: process.env.VERCEL, LEAD_IP_HMAC_SECRET: process.env.LEAD_IP_HMAC_SECRET },
    syncSheets: saveLeadToGoogleSheets,
    registerWebinar: async (submissionId) => {
      const { error } = await getSupabaseAdmin().rpc("register_webinar", { p_submission_id: submissionId });
      if (error) throw new Error("Webinar registration failed");
    },
    submit: async (args) => {
      const { data, error } = await getSupabaseAdmin().rpc("submit_lead", args);
      if (error || !data) throw new Error("Lead persistence failed");
      return data;
    },
  });
}
