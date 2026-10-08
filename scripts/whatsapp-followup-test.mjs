import { createClient } from "@supabase/supabase-js";

// Private operator tool. No provider requests or changes to the paid channel.
const env = process.env;
const phone = env.WHATSAPP_TEST_RECIPIENT;
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY || !/^\+[1-9]\d{6,14}$/.test(phone || "")) throw new Error("Missing private test configuration");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const [command = "status", jobId] = process.argv.slice(2);
let name, args;
if (["enable", "disable"].includes(command)) {
  name = "configure_whatsapp_followup_test"; args = { p_phone: phone, p_enabled: command === "enable" };
} else if (command === "status") {
  name = "whatsapp_test_job_status"; args = { p_phone: phone };
} else if (command === "advance" && /^[0-9a-f-]{36}$/i.test(jobId || "")) {
  name = "advance_whatsapp_test_job"; args = { p_phone: phone, p_job_id: jobId };
} else throw new Error("Usage: whatsapp-followup-test.mjs status|enable|disable|advance JOB_UUID");
const { data, error } = await db.rpc(name, args);
if (error) throw new Error("Test operation failed; check configuration and pending test job eligibility");
console.log(JSON.stringify({ command, result: data }, null, 2));
