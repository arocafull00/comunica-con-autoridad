import { createClient } from "@supabase/supabase-js";

// Explicitly invoked setup only. Fetch approved templates; never create one or send messages.
const env = process.env;
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_GRAPH_API_VERSION", "FOLLOWUP_WHATSAPP_TEMPLATES"];
if (required.some(key => !env[key])) throw new Error("Missing template sync configuration");
if (!/^\d+$/.test(env.WHATSAPP_BUSINESS_ACCOUNT_ID) || !/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_API_VERSION)) throw new Error("Invalid Meta configuration");
const mappings = JSON.parse(env.FOLLOWUP_WHATSAPP_TEMPLATES);
if (!mappings || Array.isArray(mappings) || typeof mappings !== "object" || Object.keys(mappings).length > 8) throw new Error("Invalid template mappings");
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: steps, error } = await db.from("followup_steps").select("key,body,parameter").eq("channel", "whatsapp");
if (error) throw new Error("Cannot read followup steps");
const templates = [];
for (const [key, config] of Object.entries(mappings)) {
  const step = steps.find(step => step.key === key);
  if (!step || typeof config?.name !== "string" || !/^[a-z0-9_]{1,512}$/.test(config.name) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(config.language)) throw new Error("Invalid step mapping");
  // One name-specific request avoids relying on pagination across the whole WABA catalog.
  const url = new URL(`https://graph.facebook.com/${env.WHATSAPP_GRAPH_API_VERSION}/${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`);
  url.searchParams.set("name", config.name);
  url.searchParams.set("fields", "name,language,status,components");
  url.searchParams.set("limit", "100");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Meta catalog unavailable");
  const result = await response.json();
  const template = result.data?.find(template => template.name === config.name && template.language === config.language && template.status === "APPROVED");
  const body = template?.components?.find(component => component.type === "BODY")?.text;
  const expected = step.parameter ? step.body.replace(`{{${step.parameter}}}`, "{{1}}") : step.body;
  if (!template || body?.replace(/\r\n/g, "\n") !== expected || template.components.some(component => !["BODY","FOOTER"].includes(component.type) || (component.type === "FOOTER" && /\{\{/.test(component.text || "")))) throw new Error("Approved template does not match the configured step");
  templates.push({ step: key, name: config.name, language: config.language, body: expected });
}
const { error: syncError } = await db.rpc("sync_followup_templates", { p_templates: templates });
if (syncError) throw new Error("Cannot store verified templates");
console.log(`${templates.length} approved followup templates synced. Sending settings have not changed.`);
