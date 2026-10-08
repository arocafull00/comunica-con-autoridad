import { handleWhatsappWebhook } from "@/lib/followups/whatsapp";
import { matchesSecret, webhookJson } from "@/lib/followups/webhook";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!token) return webhookJson(503, { ok: false });
  if (params.get("hub.mode") !== "subscribe" || !matchesSecret(params.get("hub.verify_token") ?? "", token)) return webhookJson(401, { ok: false });
  return new Response(params.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  return handleWhatsappWebhook(request, { secret: process.env.WHATSAPP_APP_SECRET, phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    save: async (messages) => {
      const { error } = await getSupabaseAdmin().rpc("record_whatsapp_replies", { p_messages: messages });
      if (error) throw new Error("Reply persistence failed");
    },
  });
}
