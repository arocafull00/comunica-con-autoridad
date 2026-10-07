import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminLoading } from "../../loading-state";
import { AuthForm } from "../../auth-form";
async function Account() { const { user } = await requireAdmin(); return <><div className="admin-page-heading"><div><h1>Mi cuenta</h1><p className="admin-muted">{user.email}</p></div><Badge variant="outline" className="admin-badge">Administrador</Badge></div><Card className="admin-panel" style={{ maxWidth: 600 }}><h2>Cambiar contraseña</h2><p className="admin-muted">Confirma tu contraseña actual para proteger el acceso al panel.</p><AuthForm mode="password" /></Card></>; }
export default function Page() { return <Suspense fallback={<AdminLoading label="Cargando cuenta…" />}><Account /></Suspense>; }
