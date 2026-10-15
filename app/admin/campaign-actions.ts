"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import { normalizeUtm } from "@/lib/admin/campaigns";
import type { ActionState } from "./actions";

const utm = z.string().transform(normalizeUtm).pipe(z.string().min(1));
const campaignSchema = z.object({ utm_source: utm, utm_medium: utm, utm_campaign: utm });

export async function saveCampaign(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { db, user } = await requireAdmin();
  const parsed = campaignSchema.safeParse({ utm_source: String(form.get("utm_source") ?? ""), utm_medium: String(form.get("utm_medium") ?? ""), utm_campaign: String(form.get("utm_campaign") ?? "") });
  if (!parsed.success) return { message: "Completa la fuente, el medio y el nombre de la campaña." };
  const { error } = await db.from("campaigns").insert({ ...parsed.data, created_by: user.id });
  if (error?.code === "23505") return { message: "Esta campaña ya está guardada." };
  if (error) return { message: "No se pudo guardar la campaña. Inténtalo de nuevo." };
  revalidatePath("/admin/campaigns");
  return { message: "Campaña guardada.", success: true };
}

export async function deleteCampaign(form: FormData) {
  const { db } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return;
  await db.from("campaigns").delete().eq("id", id.data);
  revalidatePath("/admin/campaigns");
}
