"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

type Day = { day: string; leads: number; unique_emails: number };
const dailyConfig = {
  leads: { label: "Solicitudes", color: "var(--chart-1)" },
  unique_emails: { label: "Correos únicos", color: "var(--chart-2)" },
} satisfies ChartConfig;
const shortDate = (day: string) => new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

export function DailyChart({ daily, start, end }: { daily: Day[]; start: string; end: string }) {
  const byDay = new Map(daily.map((day) => [day.day, day]));
  const days: Day[] = [];
  // The report omits inactive dates. Fill the selected interval with real zeroes.
  for (const date = new Date(`${start}T12:00:00Z`); date < new Date(`${end}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    days.push(byDay.get(day) ?? { day, leads: 0, unique_emails: 0 });
  }
  return <>
    <ChartContainer config={dailyConfig} className="admin-chart" initialDimension={{ width: 0, height: 208 }} aria-label="Gráfica diaria de solicitudes y correos únicos">
      <BarChart accessibilityLayer data={days} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="day" tick={{ fill: "var(--muted-foreground)", fontSize: 14 }} tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={32} tickMargin={10} />
        <YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 14 }} tickLine={false} axisLine={false} width={44} domain={[0, (max: number) => Math.max(1, Math.ceil(max))]} />
        <ChartTooltip content={<ChartTooltipContent className="admin-chart-tooltip" labelFormatter={(_, payload) => shortDate(payload[0].payload.day)} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="leads" fill="var(--color-leads)" radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        <Bar dataKey="unique_emails" fill="var(--color-unique_emails)" radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
    <details className="admin-chart-note"><summary>Ver datos diarios</summary><ul className="admin-list">{daily.map((day) => <li key={day.day}><time dateTime={day.day}>{shortDate(day.day)}</time><span>{day.leads} solicitudes · {day.unique_emails} correos únicos</span></li>)}</ul></details>
  </>;
}
