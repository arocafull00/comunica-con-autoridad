import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSizeSelect } from "./page-size-select";

export const PAGE_SIZES = [10, 25, 50] as const;
const formatNumber = new Intl.NumberFormat("es-ES").format;

export function pageParams(params: { page?: string; perPage?: string }) {
  const perPage = PAGE_SIZES.find((size) => size === Number(params.perPage)) ?? PAGE_SIZES[0];
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.page) || 1)));
  return { page, perPage, from: (page - 1) * perPage, to: page * perPage - 1 };
}

export function DataTablePagination({ page, perPage, total, pathname, query = {} }: { page: number; perPage: number; total: number; pathname: string; query?: Record<string, string> }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const link = (n: number) => `${pathname}?${new URLSearchParams({ ...query, perPage: String(perPage), page: String(n) })}`;
  const pageButton = (target: number, label: string, icon: ReactNode, className?: string) => target < 1 || target > totalPages || target === page
    ? <Button variant="outline" size="icon-sm" className={className} disabled aria-label={label}>{icon}</Button>
    : <Button variant="outline" size="icon-sm" className={className} asChild><Link href={link(target)} aria-label={label} scroll={false}>{icon}</Link></Button>;
  return <div className="data-table-footer">
    <p>{total ? `${formatNumber((page - 1) * perPage + 1)}–${formatNumber(Math.min(page * perPage, total))} de ${formatNumber(total)}` : "0 resultados"}</p>
    <div className="data-table-footer-controls">
      <PageSizeSelect value={perPage} options={PAGE_SIZES} pathname={pathname} query={query} />
      <span className="data-table-page-count">Página {formatNumber(Math.min(page, totalPages))} de {formatNumber(totalPages)}</span>
      <div className="data-table-page-buttons">
        {pageButton(1, "Primera página", <ChevronsLeft aria-hidden="true" />, "data-table-page-edge")}
        {pageButton(page - 1, "Página anterior", <ChevronLeft aria-hidden="true" />)}
        {pageButton(page + 1, "Página siguiente", <ChevronRight aria-hidden="true" />)}
        {pageButton(totalPages, "Última página", <ChevronsRight aria-hidden="true" />, "data-table-page-edge")}
      </div>
    </div>
  </div>;
}
