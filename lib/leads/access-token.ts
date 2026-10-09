import { createHmac, timingSafeEqual } from "node:crypto";
import { idempotencySchema } from "./validation";

function signature(payload: string, secret: string) {
  if (secret.length < 32) throw new Error("Missing access signing configuration");
  return createHmac("sha256", secret).update(`masterclass-access:${payload}`).digest("base64url");
}

// Opaque registration reference only: no email, phone or answers in browser storage.
export function signAccessToken(submissionId: string, secret: string, now = Date.now()) {
  const payload = `${submissionId}.${Math.floor(now / 1000) + 30 * 24 * 60 * 60}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyAccessToken(token: string, secret: string, now = Date.now()): string | null {
  const [id, expires, supplied, extra] = token.split(".");
  if (extra !== undefined || !idempotencySchema.safeParse(id).success || !/^\d+$/.test(expires ?? "") ||
      Number(expires) <= now / 1000 || !supplied) return null;
  const expected = Buffer.from(signature(`${id}.${expires}`, secret));
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null;
}
