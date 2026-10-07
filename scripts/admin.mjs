import { createClient } from "@supabase/supabase-js";
import { fetchTemplates } from "./meta-templates.mjs";

// Run explicitly by the site owner. No emails are sent; links are handed over privately.
async function main() {
  const [command, email] = process.argv.slice(2);
  if (!["invite", "recovery", "revoke", "sync-templates"].includes(command)) throw new Error("Usage: admin.mjs invite|recovery|revoke EMAIL, or sync-templates");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing server Supabase configuration");
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if (command === "sync-templates") {
    const templates = await fetchTemplates({ token: process.env.WHATSAPP_ACCESS_TOKEN, wabaId: process.env.WHATSAPP_WABA_ID, version: process.env.WHATSAPP_GRAPH_API_VERSION });
    const result = await db.rpc("sync_whatsapp_templates", { p_templates: templates });
    if (result.error) throw new Error("Could not synchronize template catalog");
    console.log(`${templates.length} approved compatible templates synchronized. Sending settings unchanged.`);
    return;
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provide a valid administrator email");
  if (command === "revoke") {
    let account;
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw new Error("Could not find account");
      account = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
      if (account || data.users.length < 100) break;
    }
    if (!account) throw new Error("Account not found");
    const result = await db.from("admin_accounts").update({ active: false }).eq("user_id", account.id);
    if (result.error) throw new Error("Could not revoke account");
    console.log("Administrator access revoked. Existing sessions cannot read or change dashboard data.");
    return;
  }
  const site = new URL(process.env.ADMIN_SITE_URL ?? "");
  if (site.protocol !== "https:" && !(["127.0.0.1", "localhost"].includes(site.hostname) && site.protocol === "http:")) throw new Error("ADMIN_SITE_URL must use HTTPS (HTTP is allowed only on localhost)");
  const result = await db.auth.admin.generateLink({ type: command, email, options: { redirectTo: `${site.origin}/admin/accept` } });
  if (result.error || !result.data.user || !result.data.properties?.hashed_token) throw new Error("Could not generate access link. Use recovery for an existing account.");
  const account = command === "invite" ? await db.from("admin_accounts").upsert({ user_id: result.data.user.id, active: true }) : await db.from("admin_accounts").select("active").eq("user_id", result.data.user.id).maybeSingle();
  if (account.error || (command === "recovery" && !account.data?.active)) throw new Error("Account does not have active administrator access");
  const link = new URL("/admin/accept", site.origin);
  link.searchParams.set("token_hash", result.data.properties.hashed_token);
  link.searchParams.set("type", command);
  console.log("Single-use access link. Treat as a credential and share privately:");
  console.log(link.href);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
