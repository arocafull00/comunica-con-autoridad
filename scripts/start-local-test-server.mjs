import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { startMockGoogleSheets } from "./mock-google-sheets.mjs";

// Read local test credentials into memory, without writing or printing them.
const status = JSON.parse(execSync("pnpm exec supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const url = new URL(status.API_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Browser integration tests require local Supabase");
process.env.SUPABASE_URL = status.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.ADMIN_LOCAL_HTTP = "true";
process.env.LEAD_IP_HMAC_SECRET = randomBytes(32).toString("hex");
process.env.CAL_WEBHOOK_SECRET = "local-browser-cal-secret-at-least-32-characters";
process.env.WHATSAPP_APP_SECRET = "local-browser-meta-secret-at-least-32-characters";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
process.env.EMAIL_UNSUBSCRIBE_SECRET = "local-browser-unsubscribe-secret-at-least-32-characters";
process.env.FOLLOWUP_EMAIL_SEND_ENABLED = "false";
process.env.FOLLOWUP_WHATSAPP_SEND_ENABLED = "false";
delete process.env.VERCEL;
if (process.env.MOCK_GOOGLE_SHEETS === "true") {
  process.env.GOOGLE_SHEETS_ENDPOINT = await startMockGoogleSheets();
}
process.argv = [process.argv[0], "next", "start", "--port", "3100"];
await import("next/dist/bin/next");
