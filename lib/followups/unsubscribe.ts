import { createHmac } from "node:crypto";
import { z } from "zod";
import { matchesSecret } from "./webhook";

export function unsubscribeToken(registrationId: string, secret: string) {
  if (secret.length < 32 || !z.uuid().safeParse(registrationId).success) throw new Error("Invalid unsubscribe configuration");
  return `${registrationId}.${createHmac("sha256", secret).update(`email-unsubscribe:${registrationId}`).digest("hex")}`;
}

export function readUnsubscribeToken(token: string, secret?: string): string | null {
  if (!secret || secret.length < 32 || token.length > 150) return null;
  const id = token.split(".")[0];
  if (!z.uuid().safeParse(id).success) return null;
  return matchesSecret(token, unsubscribeToken(id, secret)) ? id : null;
}
