import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { AdminLoading } from "../../loading-state";
import { AuthForm } from "../../auth-form";
async function Account() {
  const { user } = await requireAdmin();
  return <div className="admin-page admin-account">
    <div className="admin-page-heading"><div><h1>Mi cuenta</h1><p className="admin-muted">Gestiona tu acceso al panel</p></div></div>
    <div className="admin-account-grid">
      <section aria-labelledby="account-access"><h2 id="account-access">Datos de acceso</h2><dl className="admin-account-details"><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Rol</dt><dd>Administrador</dd></div></dl></section>
      <section aria-labelledby="account-password"><h2 id="account-password">Cambiar contraseña</h2><p className="admin-muted">Confirma tu contraseña actual para guardar el cambio.</p><AuthForm mode="password" /></section>
    </div>
  </div>;
}
export default function Page() { return <Suspense fallback={<AdminLoading label="Cargando cuenta…" />}><Account /></Suspense>; }
