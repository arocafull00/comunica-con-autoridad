import { describe, expect, it, vi, beforeEach } from "vitest";
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

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), traffic: vi.fn(), auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/admin/auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("../../lib/admin/traffic", () => ({ queryTraffic: mocks.traffic }));
import { getDashboard } from "../../lib/admin/data";

describe("dashboard period queries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ db: { rpc: mocks.rpc } });
    mocks.rpc.mockResolvedValue({ data: { leads: 3, unique_emails: 2 }, error: null });
    mocks.traffic.mockResolvedValue({ available: true, visitors: 10, pageviews: 20 });
  });
  it("queries both lead and traffic totals over adjacent equal ranges", async () => {
    const result = await getDashboard({ start: "2026-06-01", end: "2026-06-08" });
    expect(mocks.auth).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls).toEqual([
      ["get_lead_metrics", { p_start: "2026-06-01", p_end: "2026-06-08" }],
      ["get_lead_metrics", { p_start: "2026-05-25", p_end: "2026-06-01" }],
    ]);
    expect(mocks.traffic.mock.calls.map(([range]) => range)).toEqual([
      { start: "2026-06-01", end: "2026-06-08" }, { start: "2026-05-25", end: "2026-06-01" },
    ]);
    expect(result.previous.metrics?.unique_emails).toBe(2);
  });
  it("keeps current metrics when the previous report fails, without inventing zeros", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { leads: 3 }, error: null }).mockResolvedValueOnce({ data: null, error: {} });
    const result = await getDashboard({ start: "2026-06-01", end: "2026-06-08" });
    expect(result.metrics.leads).toBe(3);
    expect(result.previous.metrics).toBeNull();
  });
  it("reports a current data failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: {} });
    await expect(getDashboard({ start: "2026-06-01", end: "2026-06-08" })).rejects.toThrow("No se pudieron consultar las solicitudes");
  });
});
