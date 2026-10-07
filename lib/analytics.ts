import { track, type BeforeSendEvent } from "@vercel/analytics";

export function redactAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    // Only the public landing is measured. Query strings can contain personal data.
    if (url.pathname !== "/") return null;
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return { ...event, url: url.toString() };
  } catch { return null; }
}

export function trackLeadCreated() {
  try {
    // No lead data, campaign labels or idempotency keys leave the app.
    track("lead_submitted");
  } catch {
    // Analytics must never turn a saved lead into a form error.
  }
}
