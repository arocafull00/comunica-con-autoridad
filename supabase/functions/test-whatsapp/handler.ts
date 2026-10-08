import { withSupabase, type SupabaseEnv } from "npm:@supabase/server@1.9.1";
import { sendFollowup, type FollowupMessage } from "../process-followup-queue/worker.ts";

// Manual connection check. It never claims queued jobs or changes channel activation.
export function createWhatsappTestHandler(env: Record<string, string | undefined>, fetcher: typeof fetch = fetch, authEnv?: SupabaseEnv) {
  return withSupabase({ auth: "secret", cors: "disabled", env: authEnv, errors: { detailed: false } }, async (request) => {
    const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const token = env.WHATSAPP_TEST_ACCESS_TOKEN;
    const phoneNumberId = env.WHATSAPP_TEST_PHONE_NUMBER_ID;
    const version = env.WHATSAPP_TEST_GRAPH_API_VERSION;
    const recipient = env.WHATSAPP_TEST_RECIPIENT;
    if (!token || !/^\d+$/.test(phoneNumberId ?? "") || !/^v\d+\.\d+$/.test(version ?? "") || !/^\+[1-9]\d{6,14}$/.test(recipient ?? "")) {
      return json(503, { error: "test_not_configured" });
    }
    try {
      const phone = await fetcher(`https://graph.facebook.com/${version}/${phoneNumberId}?fields=id,display_phone_number`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
      });
      const data = await phone.json();
      if (!phone.ok) return json(502, { error: "test_number_unavailable" });
      if (data.id !== phoneNumberId || !/^1555\d{7}$/.test(String(data.display_phone_number ?? "").replace(/\D/g, ""))) {
        return json(409, { error: "test_number_required" });
      }
    } catch { return json(502, { error: "test_number_unavailable" }); }
    const message: FollowupMessage = {
      id: crypto.randomUUID(), registrationId: "", channel: "whatsapp", step: "connection_test",
      phone: recipient!, email: "", name: "", time: "", meetingUrl: null,
      subject: null, body: "", parameter: null, templateName: "hello_world", templateLanguage: "en_US",
    };
    const result = await sendFollowup(message, {
      email: null, whatsapp: { token, phoneNumberId: phoneNumberId!, version: version! },
    }, fetcher);
    return json(result.outcome === "sent" ? 200 : 502, result);
  });
}
