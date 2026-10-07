import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export class BodyTooLargeError extends Error {}
export const MAX_BODY_BYTES = 8 * 1024;

export async function readJsonBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new BodyTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new BodyTooLargeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export type LeadEnvironment = { LEAD_IP_HMAC_SECRET?: string; VERCEL?: string };
export function requestIpHash(request: Request, env: LeadEnvironment): string {
  const secret = env.LEAD_IP_HMAC_SECRET;
  if (!secret || secret.length < 32) throw new Error("Missing IP hashing configuration");
  // Vercel overwrites this header. Do not trust caller-provided proxy headers elsewhere.
  const ip = env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.trim() : "local";
  if (!ip || (ip !== "local" && !isIP(ip))) throw new Error("Missing trusted client IP");
  return createHmac("sha256", secret).update(ip).digest("hex");
}
