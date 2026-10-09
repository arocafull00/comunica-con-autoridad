export type Rpc = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
export type WorkerConfig = { accessToken: string; phoneNumberId: string; graphApiVersion: string };
type Claim = { action: "skip" | "busy" | "unknown" | "paused" } | {
  action: "claimed"; message_id: string; claim_token: string; name: string | null; phone: string;
  template_name: string; template_language: string; graph_api_version: string; template_parameter_count?: 0 | 1;
};
export type SendResult = { outcome: "sent"; providerId: string } | { outcome: "retry" | "failed" | "unknown"; error: string };

export async function authorized(request: Request, serviceKey: string): Promise<boolean> {
  if (!serviceKey) return false;
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [expected, supplied] = await Promise.all([digest(`Bearer ${serviceKey}`), digest(request.headers.get("authorization") ?? "")]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ supplied[i];
  return difference === 0;
}

export function loadConfig(env: (name: string) => string | undefined): WorkerConfig | null {
  if (env("WHATSAPP_SEND_ENABLED") !== "true") return null;
  const config = {
    accessToken: env("WHATSAPP_ACCESS_TOKEN") ?? "", phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID") ?? "",
    graphApiVersion: env("WHATSAPP_GRAPH_API_VERSION") ?? "",
  };
  if (!config.accessToken || !/^\d+$/.test(config.phoneNumberId) || !/^v\d+\.\d+$/.test(config.graphApiVersion)) return null;
  return config;
}

export async function sendWelcome(claim: Extract<Claim, { action: "claimed" }>, config: WorkerConfig, fetcher: typeof fetch = fetch): Promise<SendResult> {
  try {
    const response = await fetcher(`https://graph.facebook.com/${claim.graph_api_version}/${config.phoneNumberId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: claim.phone.replace(/^\+/, ""), type: "template",
        template: { name: claim.template_name, language: { code: claim.template_language },
          ...(claim.template_parameter_count === 0 ? {} : {
            components: [{ type: "body", parameters: [{ type: "text", text: claim.name || "comunicador/a" }] }],
          }) } }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    if (response.ok) {
      const id = body?.messages?.[0]?.id;
      return typeof id === "string" && id.length > 0 ? { outcome: "sent", providerId: id } : { outcome: "unknown", error: "delivery_unknown" };
    }
    const code = body?.error?.code;
    // Only a structured rejection by Meta is evidence that an automatic retry is safe.
    if (typeof code !== "number") return { outcome: "unknown", error: "delivery_unknown" };
    const transient = body.error.is_transient === true || response.status === 429 || response.status >= 500 ||
      [4, 17, 32, 613, 130429, 131056, 131048, 131000].includes(code);
    return { outcome: transient ? "retry" : "failed", error: `meta_${code}_http_${response.status}` };
  } catch {
    // A timeout/network error may happen after Meta accepted the message.
    return { outcome: "unknown", error: "delivery_unknown" };
  }
}

export async function processQueue(rpc: Rpc, config: WorkerConfig, fetcher: typeof fetch = fetch) {
  const jobs = await rpc<{ queue_id: string }[]>("read_whatsapp_jobs");
  const counts = { read: jobs.length, sent: 0, retry: 0, failed: 0, unknown: 0, skipped: 0, errors: 0 };
  let next = 0;
  const consumer = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const claim = await rpc<Claim>("claim_configured_whatsapp_job", {
          p_queue_id: job.queue_id, p_graph_api_version: config.graphApiVersion,
        });
        if (claim.action !== "claimed") {
          if (claim.action === "unknown") counts.unknown++; else counts.skipped++;
          continue;
        }
        const result = await sendWelcome(claim, config, fetcher);
        const finished = await rpc<boolean>("finish_whatsapp_job", {
          p_queue_id: job.queue_id, p_message_id: claim.message_id, p_claim_token: claim.claim_token,
          p_outcome: result.outcome, p_provider_message_id: result.outcome === "sent" ? result.providerId : null,
          p_error: result.outcome === "sent" ? null : result.error,
        });
        if (!finished) throw new Error("Claim no longer owned");
        counts[result.outcome]++;
      } catch {
        // Leave the durable job in place. An interrupted processing claim expires to delivery_unknown.
        counts.errors++;
      }
    }
  };
  await Promise.all([consumer(), consumer()]);
  return counts;
}
