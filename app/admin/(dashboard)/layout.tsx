import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { logout } from "../actions";
import { Button } from "@/components/ui/button";
import { AdminLoading } from "../loading-state";
import { AdminNavigation } from "../navigation";
import { ArrowUpRight, UserRound, LogOut } from "lucide-react";
async function Shell({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  return <div className="admin-shell">
    <a className="admin-skip" href="#admin-content">Ir al contenido</a>
    <aside className="admin-sidebar">
      <Link href="/admin" className="admin-brand">Comunica con<span>Autoridad<span className="admin-brand-caption">Panel de administración</span></span></Link>
      <AdminNavigation />
      <div className="admin-sidebar-bottom">
        <Link href="/" className="admin-public-link">Ver la web<ArrowUpRight size={16} aria-hidden="true" /></Link>
        <div className="admin-sidebar-session">
          <Link href="/admin/account" className="admin-account-link" aria-label={`Mi cuenta: ${user.email}`} title={user.email}>
            <UserRound size={18} aria-hidden="true" />
            <span><span className="admin-account-caption">Administrador</span><span className="admin-account-email">{user.email}</span></span>
          </Link>
          <form action={logout}><Button type="submit" variant="ghost" className="admin-logout"><LogOut size={16} aria-hidden="true" />Cerrar sesión</Button></form>
        </div>
      </div>
    </aside>
    <div className="admin-workspace"><main id="admin-content" className="admin-content" tabIndex={-1}>{children}</main></div>
  </div>;
}
export default function Layout({ children }: { children: React.ReactNode }) { return <Suspense fallback={<div className="admin-loading"><AdminLoading /></div>}><Shell>{children}</Shell></Suspense>; }
