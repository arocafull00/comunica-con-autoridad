import { signUnsubscribeToken } from "../_shared/email-unsubscribe.ts";
import { fetchTemplates } from "../_shared/meta-templates.ts";
import type { MetaTemplateComponent } from "../../../lib/whatsapp-template-compatibility.ts";

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

type TemplateParameter = "name" | "date" | "time" | "meetingUrl";
export type FollowupMessage = {
  id: string; registrationId: string; channel: "email" | "whatsapp"; step: string;
  email: string; phone: string; name: string | null; time: string; meetingUrl: string | null;
  subject: string | null; body: string; parameter: "name" | "time" | "meetingUrl" | null;
  templateName: string | null; templateLanguage: string | null; testMode?: boolean;
  templateComponents?: MetaTemplateComponent[];
  // Booking flow with audios: ordered body variables, start time for the date, and audio messages.
  kind?: "template" | "audio"; parameters?: TemplateParameter[] | null; startTime?: string | null; timeZone?: string | null;
};

// Converted copies of public/primer-audio-reserva.m4a and public/segundo-audio-reserva.m4a (OGG/Opus).
const audioFiles: Record<string, string> = {
  booking_audio_1: "/whatsapp/primer-audio-reserva.ogg",
  booking_audio_2: "/whatsapp/segundo-audio-reserva.ogg",
};
// Quick-reply buttons return this payload, binding the reply to the job and so to its booking revision.
export const buttonPayload = (jobId: string) => `followup:${jobId}`;
type Claim = { action: "claimed"; claimToken: string; message: FollowupMessage } | { action: "skip" | "paused" | "busy" | "unknown" | "missing_template" | "missing_meeting_url" };
export type FollowupRpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export type Config = {
  email: { key: string; from: string; siteUrl: string; unsubscribeSecret: string } | null;
  whatsapp: { token: string; phoneNumberId: string; version: string; headerImageUrl?: string; audioUrls?: Record<string, string> } | null;
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
      ? { token: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!, version: env.WHATSAPP_GRAPH_API_VERSION!,
        ...(siteUrl ? { headerImageUrl: new URL("/whatsapp/cabecera.png", siteUrl).href,
          audioUrls: Object.fromEntries(Object.entries(audioFiles).map(([step, path]) => [step, new URL(path, siteUrl).href])) } : {}) } : null,
  };
}

function templateValue(message: FollowupMessage, parameter: TemplateParameter) {
  if (parameter === "name") return message.name || "comunicador/a";
  if (parameter === "time") return message.time;
  // A missing Meet link must not stop the booking flow; booking_2h still waits for the real link.
  if (parameter === "meetingUrl") return message.meetingUrl || "te lo enviaremos antes de la sesión";
  if (!message.startTime || !message.timeZone) return "";
  return new Intl.DateTimeFormat("es-ES", { timeZone: message.timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(message.startTime));
}

function whatsappResult(response: Response, data: { messages?: { id?: unknown }[]; error?: { code?: unknown; is_transient?: unknown } } | null): Result {
  if (response.ok) {
    const id = data?.messages?.[0]?.id;
    return typeof id === "string" && id ? { outcome: "sent", providerId: id } : { outcome: "unknown", error: "delivery_unknown" };
  }
  const code = data?.error?.code;
  if (typeof code !== "number") return { outcome: "unknown", error: "delivery_unknown" };
  const retry = data?.error?.is_transient === true || response.status === 429 || response.status >= 500 || [4,17,32,613,130429,131056,131048,131000].includes(code);
  return { outcome: retry ? "retry" : "failed", error: `meta_${code}_http_${response.status}` };
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
            ...(message.step === "email_2" ? { LEAD_NAME: escapeHtml(message.name || "comunicador/a") } : {}) } } }), signal: AbortSignal.timeout(10_000),
      });
    } else {
      if (!config.whatsapp) return { outcome: "failed", error: "whatsapp_configuration_missing" };
      const endpoint = `https://graph.facebook.com/${config.whatsapp.version}/${config.whatsapp.phoneNumberId}/messages`;
      const headers = { Authorization: `Bearer ${config.whatsapp.token}`, "Content-Type": "application/json" };
      if (message.kind === "audio") {
        // Free-form audio is only valid inside the 24-hour window, which the claim has checked.
        const link = config.whatsapp.audioUrls?.[message.step];
        if (!link) return { outcome: "failed", error: "audio_missing" };
        const file = await fetcher(link, { signal: AbortSignal.timeout(10_000) });
        if (!file.ok) return { outcome: "retry", error: `audio_http_${file.status}` };
        const form = new FormData();
        form.append("messaging_product", "whatsapp");
        form.append("type", "audio/ogg");
        form.append("file", new Blob([await file.arrayBuffer()], { type: "audio/ogg" }), link.split("/").pop()!);
        const upload = await fetcher(`https://graph.facebook.com/${config.whatsapp.version}/${config.whatsapp.phoneNumberId}/media`, {
          method: "POST", headers: { Authorization: headers.Authorization }, body: form, signal: AbortSignal.timeout(20_000) });
        const media = await upload.json().catch(() => null);
        if (typeof media?.id !== "string" || !media.id) {
          return typeof media?.error?.code === "number" ? whatsappResult(upload, media) : { outcome: "retry", error: `media_upload_http_${upload.status}` };
        }
        response = await fetcher(endpoint, { method: "POST", headers, signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ messaging_product: "whatsapp", to: message.phone.replace(/^\+/, ""), type: "audio", audio: { id: media.id } }) });
        return whatsappResult(response, await response.json().catch(() => null));
      }
      if (!message.templateName || !message.templateLanguage) return { outcome: "failed", error: "whatsapp_configuration_missing" };
      const parameter = message.parameter === "name" ? (message.name || "comunicador/a") : message.parameter ? message[message.parameter] : null;
      const components: object[] = [];
      const header = message.templateComponents?.find((c) => c.type === "HEADER");
      if (header?.format === "IMAGE") {
        // The template's example handle is a signed Meta URL that fails delivery with 131053. Serve the image from the site.
        const link = config.whatsapp.headerImageUrl;
        if (!link) return { outcome: "failed", error: "template_image_missing" };
        components.push({ type: "header", parameters: [{ type: "image", image: { link } }] });
      }
      // Text, footer and fixed buttons are served by Meta. Only supply its required variables.
      const body = message.templateComponents?.find((c) => c.type === "BODY")?.text;
      if (message.parameters?.length) {
        const values = message.parameters.map((name) => templateValue(message, name));
        if (values.some((value) => !value)) return { outcome: "failed", error: "template_parameter_missing" };
        if (body !== undefined && values.some((_, index) => !body.includes(`{{${index + 1}}}`))) return { outcome: "failed", error: "template_parameter_mismatch" };
        components.push({ type: "body", parameters: values.map((text) => ({ type: "text", text })) });
      } else if (body === undefined ? !!message.parameter : body.includes("{{1}}")) {
        if (!parameter) return { outcome: "failed", error: "template_parameter_missing" };
        components.push({ type: "body", parameters: [{ type: "text", text: parameter }] });
      }
      message.templateComponents?.find((c) => c.type === "BUTTONS")?.buttons?.forEach((button, index) => {
        if (button?.type === "QUICK_REPLY") components.push({ type: "button", sub_type: "quick_reply", index: String(index),
          parameters: [{ type: "payload", payload: buttonPayload(message.id) }] });
      });
      response = await fetcher(endpoint, {
        method: "POST", headers,
        body: JSON.stringify({ messaging_product: "whatsapp", to: message.phone.replace(/^\+/, ""), type: "template",
          template: { name: message.templateName, language: { code: message.templateLanguage },
            ...(components.length ? { components } : {}) } }),
        signal: AbortSignal.timeout(10_000),
      });
    }
    const data = await response.json().catch(() => null);
    if (response.ok) {
      const id = message.channel === "email" ? data?.id : data?.messages?.[0]?.id;
      return typeof id === "string" && id ? { outcome: "sent", providerId: id } : { outcome: "unknown", error: "delivery_unknown" };
    }
    if (message.channel === "whatsapp") return whatsappResult(response, data);
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
  try {
    const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_WABA_ID: wabaId, WHATSAPP_GRAPH_API_VERSION: version } = env;
    const canSync = !!token && /^\d+$/.test(wabaId ?? "") && /^v\d+\.\d+$/.test(version ?? "");
    let catalogUnavailable = !!config.whatsapp && !canSync;
    if (canSync) {
      try {
        const templates = await fetchTemplates({ token: token!, wabaId: wabaId!, version: version! }, fetcher);
        await rpc("sync_whatsapp_templates", { p_templates: templates });
      } catch { catalogUnavailable = true; }
    }
    if (!config.email && !config.whatsapp && !config.whatsappTest) return workerJson(catalogUnavailable || !canSync ? 503 : 200, { ok: !catalogUnavailable, error: "followups_disabled_or_unconfigured" });
    // A failed catalog refresh pauses WhatsApp for this run; emails remain independent.
    const counts = await processFollowups(rpc, { ...config, whatsapp: catalogUnavailable ? null : config.whatsapp, whatsappTest: undefined }, fetcher);
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
    return workerJson(counts.errors || testCounts?.errors || catalogUnavailable ? 503 : 200, { ...counts, ...(testCounts ? { test: testCounts } : {}), ...(catalogUnavailable ? { catalog: { error: "meta_catalog_unavailable" } } : {}) });
  } catch { console.error("followup_queue_unavailable"); return workerJson(503, { ok: false }); }
}
