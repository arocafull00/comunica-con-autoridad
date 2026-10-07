import { Skeleton } from "@/components/ui/skeleton";

export function AdminLoading({ label }: { label: string }) {
  return <div className="admin-loading-skeleton" role="status" aria-busy="true"><span className="admin-muted">{label}</span><Skeleton className="h-12 w-48" /><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;
}
