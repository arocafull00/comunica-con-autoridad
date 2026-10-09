import { signUnsubscribeToken } from "../_shared/email-unsubscribe.ts";

// Stable aliases from templates/resend-templates.json. Resend serves the published HTML and text versions.
const emailTemplates: Record<string, string> = {
  email_1: "email-1-claridad",
  email_2: "email-2-casos",
  email_3: "email-3-empezar",
  email_4: "email-4-resultados",
};

function workerJson(status: number, body: object) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export type FollowupMessage = {
  id: string; registrationId: string; channel: "email" | "whatsapp"; step: string;
  email: string; phone: string; name: string; time: string; meetingUrl: string | null;
  subject: string | null; body: string; parameter: "name" | "time" | "meetingUrl" | null;
  templateName: string | null; templateLanguage: string | null; testMode?: boolean;
};
type Claim = { action: "claimed"; claimToken: string; message: FollowupMessage } | { action: "skip" | "paused" | "busy" | "unknown" | "missing_template" | "missing_meeting_url" };
export type FollowupRpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export type Config = {
  email: { key: string; from: string; siteUrl: string; unsubscribeSecret: string } | null;
  whatsapp: { token: string; phoneNumberId: string; version: string } | null;
  whatsappTest?: { token: string; phoneNumberId: string; version: string; recipient: string };
};
type Result = { outcome: "sent"; providerId: string } | { outcome: "retry" | "failed" | "unknown"; error: string };

export function loadFollowupConfig(env: Record<string, string | undefined>): Config {
  let siteUrl: string | null = null;
  try {
    const url = new URL(env.ADMIN_SITE_URL || "");
    if (url.protocol === "https:" && !url.username && !url.password) siteUrl = url.origin;
  } catch { /* Sending requires a usable public unsubscribe URL. */ }
  return {
    email: env.FOLLOWUP_EMAIL_SEND_ENABLED === "true" && env.RESEND_API_KEY && env.RESEND_FROM &&
      !/[\r\n]/.test(env.RESEND_FROM) && siteUrl && (env.EMAIL_UNSUBSCRIBE_SECRET?.length ?? 0) >= 32
      ? { key: env.RESEND_API_KEY, from: env.RESEND_FROM, siteUrl, unsubscribeSecret: env.EMAIL_UNSUBSCRIBE_SECRET! } : null,
    ...(env.FOLLOWUP_WHATSAPP_TEST_ENABLED === "true" && env.WHATSAPP_TEST_ACCESS_TOKEN &&
      /^\d+$/.test(env.WHATSAPP_TEST_PHONE_NUMBER_ID || "") && /^v\d+\.\d+$/.test(env.WHATSAPP_TEST_GRAPH_API_VERSION || "") &&
      /^\+[1-9]\d{6,14}$/.test(env.WHATSAPP_TEST_RECIPIENT || "") ? {
        whatsappTest: { token: env.WHATSAPP_TEST_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_TEST_PHONE_NUMBER_ID!,
          version: env.WHATSAPP_TEST_GRAPH_API_VERSION!, recipient: env.WHATSAPP_TEST_RECIPIENT! },
      } : {}),
    whatsapp: env.FOLLOWUP_WHATSAPP_TEST_ENABLED !== "true" && env.FOLLOWUP_WHATSAPP_SEND_ENABLED === "true" && env.WHATSAPP_ACCESS_TOKEN &&
      /^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID || "") && /^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_API_VERSION || "")
      ? { token: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!, version: env.WHATSAPP_GRAPH_API_VERSION! } : null,
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export async function sendFollowup(message: FollowupMessage, config: Config, fetcher: typeof fetch = fetch): Promise<Result> {
  if (config.whatsappTest && (message.channel !== "whatsapp" || message.testMode !== true ||
    message.phone !== config.whatsappTest.recipient || message.templateName !== "hello_world" ||
    message.templateLanguage !== "en_US" || message.parameter !== null)) {
    return { outcome: "failed", error: "sandbox_message_mismatch" };
  }
  try {
    let response: Response;
    if (message.channel === "email") {
      if (!config.email || !message.subject) return { outcome: "failed", error: "email_configuration_missing" };
      if (!Object.hasOwn(emailTemplates, message.step)) return { outcome: "failed", error: "email_template_missing" };
      const templateId = emailTemplates[message.step];
      const unsubscribe = new URL("/api/followups/unsubscribe", config.email.siteUrl);
      unsubscribe.searchParams.set("token", signUnsubscribeToken(message.registrationId, config.email.unsubscribeSecret));
      response = await fetcher("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${config.email.key}`, "Content-Type": "application/json", "Idempotency-Key": `followup/${message.id}` },
        body: JSON.stringify({ from: config.email.from, to: [message.email], subject: message.subject,
          template: { id: templateId, variables: { EMAIL_UNSUBSCRIBE_URL: unsubscribe.href,
            ...(message.step === "email_2" ? { LEAD_NAME: escapeHtml(message.name) } : {}) } } }), signal: AbortSignal.timeout(10_000),
      });
    } else {
      if (!config.whatsapp || !message.templateName || !message.templateLanguage) return { outcome: "failed", error: "whatsapp_configuration_missing" };
      const parameter = message.parameter ? message[message.parameter] : null;
      if (message.parameter && !parameter) return { outcome: "failed", error: "template_parameter_missing" };
      response = await fetcher(`https://graph.facebook.com/${config.whatsapp.version}/${config.whatsapp.phoneNumberId}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${config.whatsapp.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: message.phone.replace(/^\+/, ""), type: "template",
          template: { name: message.templateName, language: { code: message.templateLanguage },
            ...(parameter ? { components: [{ type: "body", parameters: [{ type: "text", text: parameter }] }] } : {}) } }),
        signal: AbortSignal.timeout(10_000),
      });
    }
    const data = await response.json().catch(() => null);
    if (response.ok) {
      const id = message.channel === "email" ? data?.id : data?.messages?.[0]?.id;
      return typeof id === "string" && id ? { outcome: "sent", providerId: id } : { outcome: "unknown", error: "delivery_unknown" };
    }
    if (message.channel === "whatsapp") {
      const code = data?.error?.code;
      if (typeof code !== "number") return { outcome: "unknown", error: "delivery_unknown" };
      const retry = data.error.is_transient === true || response.status === 429 || response.status >= 500 || [4,17,32,613,130429,131056,131048,131000].includes(code);
      return { outcome: retry ? "retry" : "failed", error: `meta_${code}_http_${response.status}` };
    }
    // Only a structured rejection is safe to retry. Timeouts remain for manual review.
    if (typeof data?.name !== "string") return { outcome: "unknown", error: "delivery_unknown" };
    return { outcome: response.status === 429 || response.status >= 500 ? "retry" : "failed", error: `resend_http_${response.status}` };
  } catch { return { outcome: "unknown", error: "delivery_unknown" }; }
}

export async function processFollowups(rpc: FollowupRpc, config: Config, fetcher: typeof fetch = fetch) {
  const test = config.whatsappTest;
  const flags = test ? { p_phone: test.recipient } : { p_email: !!config.email, p_whatsapp: !!config.whatsapp };
  const jobs = await rpc<{ id: string }[]>(test ? "read_whatsapp_test_jobs" : "read_followup_jobs", flags);
  const counts = { read: jobs.length, sent: 0, retry: 0, failed: 0, unknown: 0, skipped: 0, errors: 0 };
  let index = 0;
  const consumer = async () => {
    while (index < jobs.length) {
      const job = jobs[index++];
      try {
        const claim = await rpc<Claim>(test ? "claim_whatsapp_test_job" : "claim_followup_job", { p_job_id: job.id, ...flags });
        if (claim.action !== "claimed") { if (claim.action === "unknown") counts.unknown++; else counts.skipped++; continue; }
        const result = await sendFollowup(claim.message, config, fetcher);
        const finished = await rpc<boolean>("finish_followup_job", { p_id: job.id, p_token: claim.claimToken,
          p_outcome: result.outcome, p_provider_id: result.outcome === "sent" ? result.providerId : null,
          p_error: result.outcome === "sent" ? null : result.error });
        if (!finished) throw new Error("Claim no longer owned");
        counts[result.outcome]++;
      } catch { counts.errors++; }
    }
  };
  await Promise.all([consumer(), consumer()]);
  return counts;
}

export async function handleFollowupWorker(request: Request, env: Record<string, string | undefined>, rpc: FollowupRpc, fetcher: typeof fetch = fetch) {
  // Only the authenticated handler calls this processor.
  if (request.method !== "POST") return workerJson(405, { ok: false, error: "method_not_allowed" });
  const config = loadFollowupConfig(env);
  if (!config.email && !config.whatsapp && !config.whatsappTest) return workerJson(503, { ok: false, error: "followups_disabled_or_unconfigured" });
  try {
    const counts = await processFollowups(rpc, { ...config, whatsappTest: undefined }, fetcher);
    let testCounts;
    if (config.whatsappTest) {
      const test = config.whatsappTest;
      const phone = await fetcher(`https://graph.facebook.com/${test.version}/${test.phoneNumberId}?fields=id,display_phone_number`, {
        headers: { Authorization: `Bearer ${test.token}` }, signal: AbortSignal.timeout(10_000),
      });
      const data = await phone.json();
      if (!phone.ok || data.id !== test.phoneNumberId || !/^1555\d{7}$/.test(String(data.display_phone_number ?? "").replace(/\D/g, ""))) {
        return workerJson(503, { ...counts, test: { error: "sandbox_sender_unavailable" } });
      }
      testCounts = await processFollowups(rpc, { email: null, whatsapp: test, whatsappTest: test }, fetcher);
    }
    console.log(JSON.stringify({ event: "followup_queue_processed", ...counts }));
    return workerJson(counts.errors || testCounts?.errors ? 503 : 200, { ...counts, ...(testCounts ? { test: testCounts } : {}) });
  } catch { console.error("followup_queue_unavailable"); return workerJson(503, { ok: false }); }
}
