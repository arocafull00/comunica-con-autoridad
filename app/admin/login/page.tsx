import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "../auth-form";
async function Notice({ searchParams }: { searchParams: Promise<{ denied?: string; ready?: string }> }) {
  const params = await searchParams;
  return params.denied ? <p role="alert" className="admin-error">Esta cuenta no tiene acceso al panel.</p> : params.ready ? <p role="status" className="admin-success">Contraseña establecida. Ya puedes iniciar sesión.</p> : null;
}
export default function Login({ searchParams }: { searchParams: Promise<{ denied?: string; ready?: string }> }) {
  return <main className="admin-auth"><Link href="/" className="admin-brand">Comunica con Autoridad</Link><p className="eyebrow">Acceso privado</p><h1>Administración</h1><p className="admin-muted">Accede con tu cuenta de administrador.</p><Suspense><Notice searchParams={searchParams} /></Suspense><AuthForm mode="login" /><p className="admin-muted">Si has olvidado tu contraseña, solicita un nuevo enlace al responsable de la web.</p></main>;
}
