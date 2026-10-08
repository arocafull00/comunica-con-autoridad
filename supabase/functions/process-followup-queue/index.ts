import { createFollowupHandler } from "./handler.ts";

Deno.serve(createFollowupHandler(Deno.env.toObject()));
