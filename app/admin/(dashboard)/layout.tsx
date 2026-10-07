import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { logout } from "../actions";
import { Button } from "@/components/ui/button";
import { AdminLoading } from "../loading-state";
import { AdminNavigation } from "../navigation";
import { ArrowUpRight, LockKeyhole, LogOut } from "lucide-react";
async function Shell({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  return <div className="admin-shell">
    <a className="admin-skip" href="#admin-content">Ir al contenido</a>
    <aside className="admin-sidebar">
      <Link href="/admin" className="admin-brand">Comunica con<span>Autoridad<span className="admin-brand-caption">Panel de administración</span></span></Link>
      <AdminNavigation />
      <div className="admin-sidebar-bottom"><Link href="/">Ver la web<ArrowUpRight size={16} aria-hidden="true" /></Link><p><LockKeyhole size={14} aria-hidden="true" />Acceso privado</p></div>
    </aside>
    <div className="admin-workspace"><header className="admin-header"><span className="admin-header-label">Administración</span><div className="admin-session"><span>{user.email}</span><form action={logout}><Button type="submit" variant="outline"><LogOut size={16} aria-hidden="true" />Cerrar sesión</Button></form></div></header><main id="admin-content" className="admin-content" tabIndex={-1}>{children}</main></div>
  </div>;
}
export default function Layout({ children }: { children: React.ReactNode }) { return <Suspense fallback={<div className="admin-loading"><AdminLoading label="Comprobando acceso…" /></div>}><Shell>{children}</Shell></Suspense>; }
