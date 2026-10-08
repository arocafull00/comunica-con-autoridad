import { z } from "zod";
import { signUnsubscribeToken } from "../../supabase/functions/_shared/email-unsubscribe";
import { matchesSecret } from "./webhook";

export function unsubscribeToken(registrationId: string, secret: string) {
  if (secret.length < 32 || !z.uuid().safeParse(registrationId).success) throw new Error("Invalid unsubscribe configuration");
  return signUnsubscribeToken(registrationId, secret);
}

export function readUnsubscribeToken(token: string, secret?: string): string | null {
  if (!secret || secret.length < 32 || token.length > 150) return null;
  const id = token.split(".")[0];
  if (!z.uuid().safeParse(id).success) return null;
  return matchesSecret(token, unsubscribeToken(id, secret)) ? id : null;
}
