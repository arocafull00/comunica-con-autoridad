import { createWhatsappTestHandler } from "./handler.ts";

Deno.serve(createWhatsappTestHandler(Deno.env.toObject()));
