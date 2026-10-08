import { readUnsubscribeToken } from "@/lib/followups/unsubscribe";
import { getSupabaseAdmin } from "@/lib/supabase/server";

function html(status: number, content: string) {
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comunicaciones · Comunica con Autoridad</title><body><main><h1>Comunicaciones por email</h1>${content}</main></body></html>`, { status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
  } });
}

export function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!readUnsubscribeToken(token, process.env.EMAIL_UNSUBSCRIBE_SECRET)) return html(400, "<p>El enlace de baja no es válido.</p>");
  // Reading/scanning an email link never unsubscribes somebody by itself.
  return html(200, `<p>Confirma si quieres dejar de recibir esta secuencia de emails.</p><form method="post"><input type="hidden" name="token" value="${token}"><button type="submit">Dejar de recibir emails</button></form>`);
}

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > 512) return html(413, "<p>Solicitud demasiado grande.</p>");
  let token: string;
  try {
    // A tiny stream bound also covers chunked requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return html(400, "<p>Solicitud no válida.</p>");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 512) { await reader.cancel(); return html(413, "<p>Solicitud demasiado grande.</p>"); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    token = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("token") ?? "";
  } catch { return html(400, "<p>Solicitud no válida.</p>"); }
  const id = readUnsubscribeToken(token, process.env.EMAIL_UNSUBSCRIBE_SECRET);
  if (!id) return html(400, "<p>El enlace de baja no es válido.</p>");
  try {
    const { error } = await getSupabaseAdmin().rpc("unsubscribe_webinar_email", { p_registration_id: id });
    if (error) throw new Error("Unsubscribe persistence failed");
    return html(200, "<p>Ya no recibirás esta secuencia de emails. Tu acceso a la masterclass sigue disponible.</p>");
  } catch { return html(503, "<p>No hemos podido guardar la baja. Vuelve a intentarlo.</p>"); }
}
