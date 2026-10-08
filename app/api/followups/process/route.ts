import { handleFollowupWorker, type FollowupRpc } from "@/lib/followups/worker";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const rpc: FollowupRpc = async <T>(name: string, args: Record<string, unknown>) => {
    const { data, error } = await getSupabaseAdmin().rpc(name, args);
    if (error || data === null) throw new Error("Followup operation failed");
    return data as T;
  };
  return handleFollowupWorker(request, process.env, rpc);
}

export const GET = POST;
