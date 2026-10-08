import { withSupabase, type SupabaseEnv } from "npm:@supabase/server@1.9.1";
import { handleFollowupWorker, type FollowupRpc } from "./worker.ts";

export function createFollowupHandler(env: Record<string, string | undefined>, rpcOverride?: FollowupRpc, authEnv?: SupabaseEnv) {
  return withSupabase({
    auth: "secret", cors: "disabled", env: authEnv, errors: { detailed: false },
    supabaseOptions: { global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) } },
  }, async (request, context) => {
    const rpc: FollowupRpc = rpcOverride ?? (async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await context.supabaseAdmin.rpc(name, args);
      if (error || data === null) throw new Error("Followup operation failed");
      return data as T;
    });
    return handleFollowupWorker(request, env, rpc);
  });
}
