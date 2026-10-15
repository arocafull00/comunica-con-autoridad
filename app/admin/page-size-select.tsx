"use client";

import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export function PageSizeSelect({ value, options, pathname, query }: { value: number; options: readonly number[]; pathname: string; query: Record<string, string> }) {
  const router = useRouter();
  return <div className="admin-page-size">
    <Label htmlFor="page-size">Filas por página</Label>
    <NativeSelect id="page-size" size="sm" value={value} onChange={(event) => router.push(`${pathname}?${new URLSearchParams({ ...query, perPage: event.target.value, page: "1" })}`, { scroll: false })}>
      {options.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}
    </NativeSelect>
  </div>;
}
