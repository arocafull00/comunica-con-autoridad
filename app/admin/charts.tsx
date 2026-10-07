"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

type Day = { day: string; leads: number; unique_emails: number };
type Campaign = { utm_campaign: string | null; utm_source: string | null; utm_medium: string | null; leads: number; unique_emails: number };
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
    <ChartContainer config={dailyConfig} className="admin-chart" initialDimension={{ width: 0, height: 280 }} aria-label="Gráfica diaria de solicitudes y correos únicos">
      <BarChart accessibilityLayer data={days} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="day" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={28} tickMargin={10} />
        <YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} width={44} domain={[0, (max: number) => Math.max(1, Math.ceil(max))]} />
        <ChartTooltip content={<ChartTooltipContent className="admin-chart-tooltip" labelFormatter={(_, payload) => shortDate(payload[0].payload.day)} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="leads" fill="var(--color-leads)" radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        <Bar dataKey="unique_emails" fill="var(--color-unique_emails)" radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
    <details className="admin-chart-note"><summary>Ver datos diarios</summary><ul className="admin-list">{daily.map((day) => <li key={day.day}><time dateTime={day.day}>{shortDate(day.day)}</time><span>{day.leads} solicitudes · {day.unique_emails} correos únicos</span></li>)}</ul></details>
  </>;
}

export function CampaignChart({ campaigns }: { campaigns: Campaign[] }) {
  const data = campaigns.slice(0, 6).map((campaign, index) => ({ ...campaign, index: String(index), title: campaign.utm_campaign ?? "Sin campaña" }));
  return <>
    <ChartContainer config={{ leads: dailyConfig.leads }} className="admin-chart" initialDimension={{ width: 0, height: 200 }} style={{ height: Math.max(140, data.length * 44 + 32) }} aria-label="Gráfica de solicitudes por campaña">
      <BarChart accessibilityLayer layout="vertical" data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <YAxis dataKey="index" type="category" width={90} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => { const title = data[Number(value)].title; return title.length > 12 ? `${title.slice(0, 11)}…` : title; }} />
        <XAxis type="number" allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} domain={[0, (max: number) => Math.max(1, Math.ceil(max))]} />
        <ChartTooltip content={<ChartTooltipContent className="admin-chart-tooltip" labelFormatter={(_, payload) => payload[0].payload.title} />} />
        <Bar dataKey="leads" fill="var(--color-leads)" radius={[0, 3, 3, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
    {campaigns.length > 6 ? <p className="admin-chart-note">La gráfica muestra las seis primeras campañas. El detalle completo está debajo.</p> : null}
  </>;
}
