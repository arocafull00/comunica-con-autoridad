"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { authConfiguration } from "@/lib/supabase/session";
import { validVersionInput } from "../../lib/whatsapp-template-version";
import type { ActionState } from "./actions";

export async function createWhatsappTemplateVersion(_previous: ActionState, form: FormData): Promise<ActionState> {
  void _previous;
  const { session } = await requireAdmin();
  const input = { sourceId: form.get("sourceId"), name: form.get("name"), body: form.get("body") };
  if (!validVersionInput(input)) return { message: "Usa un nombre con minúsculas, números y guiones bajos, y un mensaje de hasta 1024 caracteres con una única variable {{1}}." };
  try {
    const { data, error } = await session.auth.getSession();
    if (error || !data.session) return { message: "Tu sesión ha caducado. Vuelve a iniciar sesión." };
    const { url, key } = authConfiguration();
    const response = await fetch(`${url}/functions/v1/create-whatsapp-template-version`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { message: "No se pudo verificar tu acceso. Vuelve a iniciar sesión." };
      const errors: Record<string, string> = {
        invalid_version: "El nombre o el mensaje no son válidos. Conserva una única variable {{1}} para el nombre.",
        sync_not_configured: "La creación de versiones aún no está configurada.",
        unsupported_source: "Solo se pueden versionar mensajes de texto con una variable de nombre, sin cabeceras, pies ni botones.",
        source_unavailable: "La plantilla original ya no está disponible en Meta. Sincroniza el catálogo.",
        version_name_exists: "Ese nombre ya existe en Meta. Elige un nombre distinto para la nueva versión.",
        body_unchanged: "Modifica el mensaje antes de enviarlo como una nueva versión.",
        meta_catalog_unavailable: "No se pudo comprobar el catálogo de Meta. No se ha enviado la nueva versión.",
        catalog_unavailable: "No se pudo consultar la plantilla original. Inténtalo de nuevo.",
        meta_create_rejected: "Meta no aceptó la nueva plantilla. Revisa el texto y el nombre; la plantilla original se conserva.",
        create_unknown: "No se pudo confirmar si Meta creó la nueva versión. Sincroniza el catálogo antes de volver a enviarla.",
      };
      return { message: errors[result?.error] ?? "No se pudo confirmar la creación. Sincroniza el catálogo antes de volver a enviarla." };
    }
    if (result?.name !== input.name || typeof result.status !== "string" || typeof result.stored !== "boolean") return { message: "No se pudo confirmar la creación. Sincroniza el catálogo antes de volver a enviarla." };
    revalidatePath("/admin/whatsapp");
    return { success: true, message: !result.stored
      ? `Meta recibió «${input.name}». Sincroniza el catálogo para verla. La plantilla de envío no ha cambiado.`
      : result.status === "APPROVED"
        ? `«${input.name}» ya está aprobada. Puedes seleccionarla y guardarla cuando quieras; la plantilla de envío no ha cambiado.`
        : `«${input.name}» se ha enviado a Meta. Sincroniza para consultar su aprobación; la plantilla de envío no ha cambiado.` };
  } catch { return { message: "No se pudo confirmar si Meta creó la nueva versión. Sincroniza el catálogo antes de volver a enviarla." }; }
}
