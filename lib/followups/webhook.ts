import { createHmac, timingSafeEqual } from "node:crypto";

export class WebhookBodyError extends Error {
  constructor(public status: number) { super("Invalid webhook body"); }
}

export function matchesSecret(supplied: string, expected: string) {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function signedWebhook(request: Request, secret: string | undefined, header: string, prefix = "") {
  if (!secret || secret.length < 32) throw new WebhookBodyError(503);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new WebhookBodyError(415);
  const limit = 256 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new WebhookBodyError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new WebhookBodyError(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new WebhookBodyError(413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = Buffer.concat(chunks);
  const expected = prefix + createHmac("sha256", secret).update(body).digest("hex");
  if (!matchesSecret(request.headers.get(header) ?? "", expected)) throw new WebhookBodyError(401);
  try { return JSON.parse(body.toString("utf8")) as unknown; }
  catch { throw new WebhookBodyError(400); }
}

export function webhookJson(status: number, body: object) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
