"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { redactAnalyticsEvent } from "@/lib/analytics";

export function WebAnalytics() {
  return (
    <>
      <Analytics beforeSend={redactAnalyticsEvent} debug={false} />
      <SpeedInsights beforeSend={redactAnalyticsEvent} debug={false} />
    </>
  );
}
