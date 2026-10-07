"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, acceptInvitation, changePassword } from "./actions";

export function AuthForm({ mode, tokenHash = "", type = "invite" }: { mode: "login" | "accept" | "password"; tokenHash?: string; type?: string }) {
  const action = mode === "login" ? login : mode === "accept" ? acceptInvitation : changePassword;
  const [state, dispatch, pending] = useActionState(action, { message: "" });
  return <form action={dispatch} className="admin-form">
    <fieldset disabled={pending}>
      {mode === "login" ? <><Label>Email<Input name="email" type="email" autoComplete="username" required maxLength={254} /></Label><Label>Contraseña<Input name="password" type="password" autoComplete="current-password" required maxLength={128} /></Label></> : <>
        {mode === "password" ? <Label>Contraseña actual<Input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></Label> : <><input type="hidden" name="tokenHash" value={tokenHash} /><input type="hidden" name="type" value={type} /></>}
        <Label>Nueva contraseña<Input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></Label>
        <Label>Repetir contraseña<Input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></Label>
        <p className="admin-muted">Utiliza al menos 12 caracteres.</p>
      </>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : mode === "login" ? "Entrar" : mode === "accept" ? "Establecer contraseña" : "Cambiar contraseña"}</Button>
    </fieldset>
    <p role="status" className={state.success ? "admin-success" : "admin-error"}>{state.message}</p>
  </form>;
}
