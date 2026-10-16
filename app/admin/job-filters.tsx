"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { JOB_STATUSES } from "./job-filter-params";

export function JobFilters({ pathname, perPage, status, step, order, steps }: { pathname: string; perPage: number; status: string; step: string; order: "asc" | "desc"; steps: readonly { key: string; title: string }[] }) {
  const router = useRouter();
  const current = { status, step, order: order === "asc" ? "asc" : "" };
  const update = (name: keyof typeof current, value: string) => {
    const next = Object.fromEntries(Object.entries({ ...current, [name]: value }).filter(([, v]) => v));
    router.push(`${pathname}?${new URLSearchParams({ ...next, perPage: String(perPage), page: "1" })}`, { scroll: false });
  };
  return <div className="data-table-toolbar data-table-filters">
    <div className="data-table-filter">
      <Label htmlFor="job-filter-status">Estado</Label>
      <NativeSelect id="job-filter-status" size="sm" value={status} onChange={(event) => update("status", event.target.value)}>
        <NativeSelectOption value="">Todos</NativeSelectOption>
        {JOB_STATUSES.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
      </NativeSelect>
    </div>
    <div className="data-table-filter">
      <Label htmlFor="job-filter-step">Mensaje</Label>
      <NativeSelect id="job-filter-step" size="sm" value={step} onChange={(event) => update("step", event.target.value)}>
        <NativeSelectOption value="">Todos</NativeSelectOption>
        {steps.map((option) => <NativeSelectOption key={option.key} value={option.key}>{option.title}</NativeSelectOption>)}
      </NativeSelect>
    </div>
    <div className="data-table-filter">
      <Label htmlFor="job-filter-order">Programado</Label>
      <NativeSelect id="job-filter-order" size="sm" value={order} onChange={(event) => update("order", event.target.value === "asc" ? "asc" : "")}>
        <NativeSelectOption value="desc">Más reciente primero</NativeSelectOption>
        <NativeSelectOption value="asc">Más antiguo primero</NativeSelectOption>
      </NativeSelect>
    </div>
    {status || step || order === "asc" ? <Button variant="ghost" size="sm" asChild><Link href={`${pathname}?${new URLSearchParams({ perPage: String(perPage) })}`} scroll={false}>Limpiar <X aria-hidden="true" /></Link></Button> : null}
  </div>;
}
