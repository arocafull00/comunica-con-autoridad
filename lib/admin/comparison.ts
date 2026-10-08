type Range = { start: string; end: string };

// Count calendar dates, rather than elapsed Madrid hours, across DST changes.
export function comparisonPeriod(range: Range) {
  const days = (Date.parse(range.end) - Date.parse(range.start)) / 86_400_000;
  const start = new Date(Date.parse(range.start) - days * 86_400_000).toISOString().slice(0, 10);
  return { days, range: { start, end: range.start } };
}

export function metricChange(current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  const absolute = current - previous;
  return { absolute, percent: previous === 0 ? current === 0 ? 0 : null : absolute / previous * 100 };
}

export function conversionRate(leads: number, visitors: number | null) {
  return visitors !== null && visitors > 0 ? leads / visitors * 100 : null;
}
