import { createClient } from "@supabase/supabase-js";
import { fetchTemplates } from "../supabase/functions/_shared/meta-templates.ts";

// Optional operational refresh. Trigger associations are fixed in the migration.
const env = process.env;
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_WABA_ID", "WHATSAPP_GRAPH_API_VERSION"];
if (required.some(key => !env[key])) throw new Error("Missing template sync configuration");
const templates = await fetchTemplates({ token: env.WHATSAPP_ACCESS_TOKEN, wabaId: env.WHATSAPP_WABA_ID, version: env.WHATSAPP_GRAPH_API_VERSION });
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { error } = await db.rpc("sync_whatsapp_templates", { p_templates: templates });
if (error) throw new Error("Cannot store Meta catalog");
console.log(`${templates.length} Meta templates synced. Sending settings have not changed.`);
