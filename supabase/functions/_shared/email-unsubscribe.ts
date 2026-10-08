import { createHmac } from "node:crypto";

export function signUnsubscribeToken(registrationId: string, secret: string) {
  return `${registrationId}.${createHmac("sha256", secret).update(`email-unsubscribe:${registrationId}`).digest("hex")}`;
}
