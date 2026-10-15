import { z } from "zod";
import { profileQualificationSchema } from "@/lib/leads/booking-validation";
import { verifyAccessToken } from "@/lib/leads/access-token";
import { readJsonBody } from "@/lib/leads/request";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const progressSchema = z.object({ step: z.number().int().min(1).max(7), answers: z.record(z.string(), z.unknown()) }).strict();
const answerFields = profileQualificationSchema.shape;

function validAnswers(answers: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(answerFields).flatMap(([field, schema]) => {
    const parsed = schema.safeParse(answers[field]);
    return answers[field] !== undefined && parsed.success ? [[field, parsed.data]] : [];
  }));
}

export async function POST(request: Request) {
  const done = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const id = verifyAccessToken(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", process.env.LEAD_IP_HMAC_SECRET ?? "");
    if (!id) return done(401);
    let raw: unknown;
    try { raw = await readJsonBody(request); } catch { return done(400); }
    const parsed = progressSchema.safeParse(raw);
    if (!parsed.success) return done(400);
    const { data, error } = await getSupabaseAdmin().rpc("save_masterclass_progress", { p_submission_id: id, p_step: parsed.data.step, p_answers: validAnswers(parsed.data.answers) });
    if (error || !data) throw new Error("Progress persistence failed");
    return done(data.outcome === "missing" ? 401 : 204);
  } catch {
    console.error("masterclass_progress_unavailable");
    return done(503);
  }
}
