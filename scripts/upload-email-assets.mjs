import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase server credentials are required.");
const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = "email-assets";
const { data: settings, error: bucketError } = await client.storage.getBucket(bucket);
if (bucketError || !settings?.public) throw new Error("Apply the email-assets bucket migration before uploading public photography.");

const assets = {};
for (const file of ["santiago.jpg", "maria.jpeg", "mateo.jpeg"]) {
  const bytes = readFileSync(`public/${file}`);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const path = `success-stories/${hash}-${file}`;
  const { data: { publicUrl } } = client.storage.from(bucket).getPublicUrl(path);
  const existing = await fetch(publicUrl, { method: "HEAD" });
  if (!existing.ok) {
    const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
    if (error) throw new Error(`Could not upload ${file}: ${error.message}`);
  }
  // Confirm the URL really serves the original image without credentials.
  const response = await fetch(publicUrl);
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error(`Public image unavailable: ${file}`);
  const actualHash = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex").slice(0, 16);
  if (actualHash !== hash) throw new Error(`Public image content mismatch: ${file}`);
  assets[file] = publicUrl;
  console.log(`${file}: verified public JPEG`);
}

const manifest = JSON.parse(readFileSync("templates/resend-templates.json", "utf8"));
const previousAssets = manifest.assets ?? {};
for (const entry of manifest.templates) {
  const file = `templates/${entry.file}`;
  let html = readFileSync(file, "utf8");
  for (const [image, url] of Object.entries(assets)) {
    const oldUrl = previousAssets[image] ?? `https://webinar.comunicaconautoridad.com/${image}`;
    html = html.replaceAll(oldUrl, url);
  }
  writeFileSync(file, html);
}
manifest.assets = assets;
writeFileSync("templates/resend-templates.json", JSON.stringify(manifest, null, 2) + "\n");
