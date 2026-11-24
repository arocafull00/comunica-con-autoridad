import { describe, expect, it } from "vitest";
import { comparisonPeriod, conversionRate, metricChange } from "../../lib/admin/comparison";

describe("summary comparisons", () => {
  it.each([
    ["2026-06-01", "2026-06-08", 7, "2026-05-25"],
    ["2026-06-01", "2026-07-01", 30, "2026-05-02"],
    ["2026-03-29", "2026-03-30", 1, "2026-03-28"],
    ["2026-10-24", "2026-10-27", 3, "2026-10-21"],
    ["2024-02-29", "2024-03-01", 1, "2024-02-28"],
  ])("compares %s–%s with exactly the previous calendar period", (start, end, days, previousStart) => {
    expect(comparisonPeriod({ start, end })).toEqual({ days, range: { start: previousStart, end: start } });
  });
  it("computes growth, declines and stable counts", () => {
    expect(metricChange(30, 20)).toEqual({ absolute: 10, percent: 50 });
    expect(metricChange(10, 20)).toEqual({ absolute: -10, percent: -50 });
    expect(metricChange(0, 20)).toEqual({ absolute: -20, percent: -100 });
    expect(metricChange(20, 20)).toEqual({ absolute: 0, percent: 0 });
  });
  it("distinguishes zero from missing data and an undefined percentage", () => {
    expect(metricChange(3, 0)).toEqual({ absolute: 3, percent: null });
    expect(metricChange(0, 0)).toEqual({ absolute: 0, percent: 0 });
    expect(metricChange(3, null)).toBeNull();
    expect(metricChange(null, 3)).toBeNull();
  });
  it("compares conversion relatively or in percentage points", () => {
    expect(metricChange(conversionRate(30, 100), conversionRate(20, 100))).toEqual({ absolute: 10, percent: 50 });
    expect(conversionRate(0, 100)).toBe(0);
    expect(conversionRate(3, 0)).toBeNull();
    expect(conversionRate(3, null)).toBeNull();
  });
});
