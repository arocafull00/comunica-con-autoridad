"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps, type FormEvent } from "react";
import dynamic from "next/dynamic";
import type { IntlTelInputRef } from "intl-tel-input/react";
import { COMMUNICATIONS_CONSENT_TEXT, WHATSAPP_CONSENT_TEXT, type LeadField, type LeadFieldErrors, type LeadResponse } from "@/lib/leads/contracts";
import { trackLeadCreated } from "@/lib/analytics";
import { readLeadAttribution } from "@/lib/leads/attribution";

const PhoneInput = dynamic(() => import("intl-tel-input/reactWithUtils"), { ssr: false });
const PHONE_OPTIONS: ComponentProps<typeof PhoneInput>["initOptions"] = {
  initialCountry: "es", separateDialCode: true, nationalMode: true, strictMode: true,
  countrySearch: true, countryOrder: ["es", "mx", "co", "ve", "ar", "cl", "pe", "ec", "us"],
  validationNumberTypes: ["MOBILE"],
};

export function LeadForm({ onSuccess }: { onSuccess: (accessToken: string) => void }) {
  const inFlight = useRef(false);
  const submission = useRef<{ key: string; payload: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const phoneRef = useRef<IntlTelInputRef>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const clearPhoneError = useCallback(() => setErrors(current => ({ ...current, phone: undefined })), []);
  useEffect(() => { formRef.current?.querySelector<HTMLInputElement>("[name=email]")?.focus({ preventScroll: true }); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const email = event.currentTarget.elements.namedItem("email") as HTMLInputElement;
    if (!email.checkValidity()) {
      setErrors({ email: "Introduce un email válido." }); email.focus(); return;
    }
    const phone = phoneRef.current?.getInstance();
    if (!phone?.isValidNumberPrecise()) {
      setErrors({ phone: "Introduce un número de móvil válido. No se admiten teléfonos fijos." });
      phoneRef.current?.getInput()?.focus(); return;
    }
    inFlight.current = true;
    setPending(true); setMessage(""); setErrors({});
    const values = new FormData(event.currentTarget);
    const payload = JSON.stringify({
      phone: phone.getNumber(), email: email.value.trim(),
      whatsappConsent: values.get("whatsappConsent") === "on",
      communicationsConsent: values.get("communicationsConsent") === "on",
      website: String(values.get("website") ?? ""), ...readLeadAttribution(window.location.search),
    });
    if (!submission.current || submission.current.payload !== payload) submission.current = { key: crypto.randomUUID(), payload };
    try {
      const response = await fetch("/api/leads/access", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": submission.current.key },
        body: payload, signal: AbortSignal.timeout(25_000),
      });
      const result: LeadResponse = await response.json();
      if (response.ok && result.ok && result.accessToken) {
        if (response.status === 201) trackLeadCreated();
        onSuccess(result.accessToken);
      } else {
        setMessage(result.message || "No hemos podido guardar tu solicitud. Vuelve a intentarlo.");
        setErrors(result.fieldErrors ?? {});
        if (response.status === 409) submission.current = null;
        const firstField = Object.keys(result.fieldErrors ?? {})[0];
        if (firstField === "phone") phoneRef.current?.getInput()?.focus();
        else if (firstField === "email") email.focus();
      }
    } catch { setMessage("No hemos podido confirmar tu solicitud. Tus datos siguen aquí; vuelve a intentarlo."); }
    finally { inFlight.current = false; setPending(false); }
  }
  const error = (field: LeadField) => errors[field] ? <div className="field-error" id={`${field}-error`} role="alert">{errors[field]}</div> : null;

  return <div id="lead-form-wrap">
    <form id="lead-form" name="webinar-leads" ref={formRef} onSubmit={submit} noValidate aria-label="Acceso a la masterclass" aria-busy={pending}>
      <fieldset disabled={pending}>
        <legend className="sr-only">Tus datos para acceder a la masterclass</legend>
        <div className="form-step active">
          <h3>Accede gratis a la masterclass</h3><p>Completa tu WhatsApp y correo para ver el vídeo.</p>
          <div className="contact-field">
            <label htmlFor="telefono_visible">Móvil / WhatsApp</label>
            <PhoneInput ref={phoneRef} initOptions={PHONE_OPTIONS} disabled={pending} inputProps={{ id: "telefono_visible", type: "tel", inputMode: "tel", autoComplete: "tel-national", placeholder: "600 000 000", required: true, onChange: clearPhoneError, "aria-invalid": !!errors.phone, "aria-describedby": errors.phone ? "phone-error phone-hint" : "phone-hint" }} />
            {error("phone")}
            <div className="phone-hint" id="phone-hint">Selecciona tu país y escribe tu móvil.</div>
          </div>
          <div className="contact-field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" placeholder="tu@email.com" required maxLength={254} aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} onInput={() => setErrors(current => ({ ...current, email: undefined }))} />
            {error("email")}
          </div>
          <label className="whatsapp-consent" htmlFor="whatsappConsent"><input id="whatsappConsent" name="whatsappConsent" type="checkbox" /> <span>{WHATSAPP_CONSENT_TEXT} (Opcional)</span></label>
          <label className="whatsapp-consent" htmlFor="communicationsConsent"><input id="communicationsConsent" name="communicationsConsent" type="checkbox" /> <span>{COMMUNICATIONS_CONSENT_TEXT} (Opcional)</span></label>
          <div className="form-actions"><button className="form-submit" type="submit">{pending ? "GUARDANDO..." : "Continuar →"}</button></div>
        </div>
        <div className="honeypot" aria-hidden="true"><label htmlFor="website">Deja este campo vacío</label><input id="website" name="website" tabIndex={-1} autoComplete="off" maxLength={200} /></div>
      </fieldset>
      <p className="form-message" role="alert">{message}</p>
    </form>
  </div>;
}
