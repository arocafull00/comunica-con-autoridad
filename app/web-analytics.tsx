"use client";

import { Analytics } from "@vercel/analytics/next";
import { redactAnalyticsEvent } from "@/lib/analytics";

export function WebAnalytics() {
  return <Analytics beforeSend={redactAnalyticsEvent} debug={false} />;
}
