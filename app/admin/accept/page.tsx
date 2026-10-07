import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "../auth-form";
import { tokenHashSchema } from "@/lib/admin/validation";
async function Accept({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const params = await searchParams;
  if (!tokenHashSchema.safeParse(params.token_hash).success || !["invite", "recovery"].includes(params.type ?? "")) return <p role="alert">El enlace no es válido. Solicita uno nuevo al responsable de la web.</p>;
  return <AuthForm mode="accept" tokenHash={params.token_hash} type={params.type} />;
}
export default function Page({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  return <main className="admin-auth"><Link className="admin-brand" href="/">Comunica con Autoridad</Link><h1>Tu acceso al panel</h1><p className="admin-muted">Establece una contraseña para tu cuenta. El enlace se consumirá al guardar.</p><Suspense fallback={<p>Comprobando enlace…</p>}><Accept searchParams={searchParams} /></Suspense></main>;
}
