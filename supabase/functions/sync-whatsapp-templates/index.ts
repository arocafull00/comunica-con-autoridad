import { createTemplateSyncHandler } from "./handler.ts";

Deno.serve(createTemplateSyncHandler(Deno.env.toObject()));
