"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { authConfiguration } from "@/lib/supabase/session";
import type { ActionState } from "./actions";

export async function syncWhatsappTemplates(_previous: ActionState): Promise<ActionState> {
  void _previous;
  const { session } = await requireAdmin();
  try {
    const { data, error } = await session.auth.getSession();
    if (error || !data.session) return { message: "Tu sesión ha caducado. Vuelve a iniciar sesión." };
    const { url, key } = authConfiguration();
    const response = await fetch(`${url}/functions/v1/sync-whatsapp-templates`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${data.session.access_token}` },
      cache: "no-store", signal: AbortSignal.timeout(45_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { message: "No se pudo verificar tu acceso. Vuelve a iniciar sesión." };
      if (result?.error === "sync_not_configured" || response.status === 404) return { message: "La sincronización con Meta aún no está configurada. Contacta con el responsable de la web." };
      if (result?.error === "meta_catalog_unavailable") return { message: "No se pudo consultar Meta. El catálogo anterior se conserva. Inténtalo de nuevo." };
      return { message: "No se pudo actualizar el catálogo. Inténtalo de nuevo." };
    }
    if (!Number.isInteger(result?.count) || result.count < 0 || result.count > 1000) return { message: "No se pudo confirmar la sincronización. Recarga la página." };
    revalidatePath("/admin/whatsapp");
    return { message: result.count === 0 ? "Sincronización completada. No hay plantillas aprobadas compatibles en Meta." : `${result.count} ${result.count === 1 ? "plantilla aprobada sincronizada" : "plantillas aprobadas sincronizadas"}.`, success: true };
  } catch { return { message: "No se pudo confirmar la sincronización. Recarga la página antes de volver a intentarlo." }; }
}
