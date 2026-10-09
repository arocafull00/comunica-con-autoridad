import { createTemplateVersionHandler } from "./handler.ts";
Deno.serve(createTemplateVersionHandler(Deno.env.toObject()));
