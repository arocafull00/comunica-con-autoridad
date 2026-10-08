"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function shiftDate(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
const displayDate = (day: string) => new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

export function DateRangeFilter({ start, end, todayEnd, pathname = "/admin", query = {} }: { start: string; end: string; todayEnd: string; pathname?: string; query?: Record<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const inclusiveEnd = shiftDate(end, -1);
  const rangeUrl = (first: string, last: string) => `${pathname}?${new URLSearchParams({ ...query, start: first, end: last })}`;
  return <div className="admin-period">
    <span className="admin-period-label">Período · hora de Madrid</span>
    <div className="admin-period-controls">
      <nav className="admin-period-presets" aria-label="Períodos rápidos">
        {[7, 30, 90].map((days) => {
          const first = shiftDate(todayEnd, -days);
          const selected = start === first && end === todayEnd;
          return <Link key={days} href={rangeUrl(first, todayEnd)} prefetch={false} scroll={false} aria-current={selected ? "true" : undefined}>{days} días</Link>;
        })}
      </nav>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild><Button variant="outline" className="admin-period-trigger" aria-label="Cambiar período"><CalendarDays size={16} aria-hidden="true" /><span>{displayDate(start)} · {displayDate(inclusiveEnd)}</span><ChevronDown size={14} aria-hidden="true" /></Button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="admin-root admin-range-popover" align="end" sideOffset={8} collisionPadding={16} aria-label="Seleccionar período">
          <h2>Fechas personalizadas</h2>
          <p className="admin-muted">Incluye ambos días. Máximo 366 días.</p>
          <form onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const first = String(data.get("start"));
            const last = String(data.get("last"));
            const nextEnd = shiftDate(last, 1);
            const days = (Date.parse(nextEnd) - Date.parse(first)) / 86400000;
            if (days < 1 || days > 366) { setError("Elige un período de entre 1 y 366 días."); return; }
            setError(""); setOpen(false); router.push(rangeUrl(first, nextEnd), { scroll: false });
          }}>
            <div className="admin-range-fields"><div><Label htmlFor="period-start">Desde</Label><Input id="period-start" type="date" name="start" defaultValue={start} required /></div><div><Label htmlFor="period-last">Hasta</Label><Input id="period-last" type="date" name="last" defaultValue={inclusiveEnd} required /></div></div>
            {error ? <p className="admin-error" role="alert">{error}</p> : null}
            <div className="admin-range-actions"><Popover.Close asChild><Button variant="ghost" type="button">Cancelar</Button></Popover.Close><Button type="submit">Aplicar período</Button></div>
          </form>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    </div>
  </div>;
}
