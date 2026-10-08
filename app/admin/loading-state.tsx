import { Skeleton } from "@/components/ui/skeleton";

export function AdminLoading() {
  return <div className="admin-loading-skeleton" role="status" aria-label="Cargando" aria-busy="true"><Skeleton className="h-12 w-48" /><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;
}
