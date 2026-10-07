import assert from "node:assert/strict";
import { execSync } from "node:child_process";

const local = JSON.parse(execSync("pnpm exec supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const base = new URL(local.API_URL);
if (!["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Worker checks require localhost");
const url = `${base.origin}/functions/v1/process-whatsapp-queue`;
for (const [label, token, expected] of [["missing credential", null, 401], ["anon JWT", local.ANON_KEY, 401], ["service JWT with sends disabled", local.SERVICE_ROLE_KEY, 503]]) {
  const response = await fetch(url, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, expected, `${label}: unexpected HTTP status`);
  if (expected === 503) assert.equal((await response.json()).error, "whatsapp_not_configured_or_disabled");
  else await response.text();
  console.log(`${label}: HTTP ${expected}`);
}
