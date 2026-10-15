import { z } from "zod";
import { FUNNEL_EVENTS, type FunnelEvent } from "@/lib/funnel";
import { readJsonBody } from "@/lib/leads/request";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const eventSchema = z.object({
  sessionId: z.uuid(),
  event: z.custom<FunnelEvent>(value => FUNNEL_EVENTS.includes(value as FunnelEvent)),
}).strict();

export async function POST(request: Request) {
  const done = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  let raw: unknown;
  try { raw = await readJsonBody(request); } catch { return done(400); }
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return done(400);
  try {
    const { error } = await getSupabaseAdmin().rpc("record_funnel_event", { p_session_id: parsed.data.sessionId, p_event: parsed.data.event });
    if (error) throw error;
    return done(204);
  } catch {
    console.error("funnel_event_unavailable");
    return done(503);
  }
}
