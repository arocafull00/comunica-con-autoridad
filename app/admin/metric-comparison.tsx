"use client";

import { useState } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { metricChange } from "@/lib/admin/comparison";

const signed = (value: number, digits: number) => new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: digits, signDisplay: "exceptZero",
}).format(value);

export function MetricComparison({ label, current, previous, days, rate = false }: {
  label: string; current: number | null; previous: number | null; days: number; rate?: boolean;
}) {
  const [absolute, setAbsolute] = useState(false);
  const change = metricChange(current, previous);
  if (!change) return <span className="admin-comparison-unavailable">Comparación no disponible</span>;

  const direction = change.absolute > 0 ? "up" : change.absolute < 0 ? "down" : "flat";
  const Icon = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;
  const value = absolute ? `${signed(change.absolute, rate ? 1 : 0)}${rate ? " p. p." : ""}`
    : change.percent === null ? "Sin base previa" : `${signed(change.percent, 1)} %`;
  const period = `${days} ${days === 1 ? "día anterior" : "días anteriores"}`;
  return <div className="admin-comparison">
    <button type="button" data-slot="metric-comparison" className={`admin-comparison-toggle admin-comparison-${direction}`} aria-pressed={absolute}
      aria-label={`${label}: ${value}. Mostrar ${absolute ? "porcentaje" : "diferencia absoluta"}`}
      title={`Mostrar ${absolute ? "porcentaje" : "diferencia absoluta"}`}
      onClick={() => setAbsolute((value) => !value)}>
      <Icon size={20} strokeWidth={2} aria-hidden="true" /><span>{value}</span>
    </button>
    <span className="admin-comparison-period">vs. {period}</span>
  </div>;
}
