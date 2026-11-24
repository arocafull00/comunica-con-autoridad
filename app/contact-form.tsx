"use client";

import { useEffect, useRef, useState, type ComponentProps, type FormEvent } from "react";
import dynamic from "next/dynamic";
import type { IntlTelInputRef } from "intl-tel-input/react";
import type { LeadFieldErrors } from "@/lib/leads/contracts";
import { bookingContactSchema, type BookingContact } from "@/lib/leads/booking-validation";

const PhoneInput = dynamic(() => import("intl-tel-input/reactWithUtils"), { ssr: false });
const PHONE_OPTIONS: ComponentProps<typeof PhoneInput>["initOptions"] = {
  initialCountry: "es", separateDialCode: true, nationalMode: true, strictMode: true,
  countrySearch: true, countryOrder: ["es", "mx", "co", "ve", "ar", "cl", "pe", "ec", "us"],
  validationNumberTypes: ["MOBILE"],
};

export function ContactForm({ onContinue }: { onContinue: (contact: BookingContact) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const phoneRef = useRef<IntlTelInputRef>(null);
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  useEffect(() => { formRef.current?.querySelector<HTMLInputElement>("[name=name]")?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const first = (["name", "email", "phone"] as const).find(field => errors[field]);
    if (first === "phone") phoneRef.current?.getInput()?.focus();
    else if (first) formRef.current?.querySelector<HTMLInputElement>(`[name=${first}]`)?.focus();
  }, [errors]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const email = form.elements.namedItem("email") as HTMLInputElement;
    const phone = phoneRef.current?.getInstance();
    const invalid: LeadFieldErrors = {};
    if (name.length < 2) invalid.name = "Introduce tu nombre (mínimo 2 caracteres).";
    if (!email.value.trim() || !email.checkValidity()) invalid.email = "Introduce un email válido.";
    if (!phone?.isValidNumberPrecise()) invalid.phone = "Introduce un número de móvil válido. No se admiten teléfonos fijos.";
    if (Object.keys(invalid).length) { setErrors(invalid); return; }
    const contact = bookingContactSchema.safeParse({
      name, email: email.value.trim(), phone: phone!.getNumber(),
      website: String(new FormData(form).get("website") ?? ""),
    });
    if (!contact.success) {
      for (const issue of contact.error.issues) {
        const field = issue.path[0];
        if (field === "name" || field === "email" || field === "phone") invalid[field] ??= issue.message;
      }
      setErrors(invalid);
      return;
    }
    onContinue(contact.data);
  }
  const error = (field: "name" | "email" | "phone") => errors[field] ? <div className="field-error" id={`contact-${field}-error`} role="alert">{errors[field]}</div> : null;
  const describedBy = (field: "name" | "email" | "phone") => errors[field] ? `contact-${field}-error` : undefined;

  return <div id="contact-form-wrap">
    <form id="contact-form" name="webinar-leads" ref={formRef} onSubmit={submit} noValidate aria-label="Datos para agendar la llamada">
      <fieldset>
        <legend className="sr-only">Tus datos de contacto</legend>
        <div className="form-step active">
          <h3>¿Cómo podemos contactarte?</h3>
          <div className="contact-field">
            <label htmlFor="contact-name">Nombre</label>
            <input id="contact-name" name="name" type="text" autoComplete="name" required minLength={2} maxLength={100} placeholder="Tu nombre" aria-invalid={!!errors.name} aria-describedby={describedBy("name")} onInput={() => setErrors(current => ({ ...current, name: undefined }))} />
            {error("name")}
          </div>
          <div className="contact-field">
            <label htmlFor="contact-email">Email</label>
            <input id="contact-email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="tu@email.com" aria-invalid={!!errors.email} aria-describedby={describedBy("email")} onInput={() => setErrors(current => ({ ...current, email: undefined }))} />
            {error("email")}
          </div>
          <div className="contact-field">
            <label htmlFor="telefono_visible">Número de WhatsApp</label>
            <PhoneInput ref={phoneRef} initOptions={PHONE_OPTIONS} inputProps={{ id: "telefono_visible", type: "tel", inputMode: "tel", autoComplete: "tel-national", placeholder: "600 000 000", required: true, onChange: () => setErrors(current => ({ ...current, phone: undefined })), "aria-invalid": !!errors.phone, "aria-describedby": errors.phone ? "contact-phone-error phone-hint" : "phone-hint" }} />
            {error("phone")}
            <div className="phone-hint" id="phone-hint">Selecciona tu país y escribe tu móvil.</div>
          </div>
          <div className="form-actions"><button className="form-submit" type="submit">Continuar →</button></div>
        </div>
        <div className="honeypot" aria-hidden="true"><label htmlFor="website">Deja este campo vacío</label><input id="website" name="website" tabIndex={-1} autoComplete="off" maxLength={200} /></div>
      </fieldset>
    </form>
  </div>;
}
