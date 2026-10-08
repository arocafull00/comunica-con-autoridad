"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps, type FormEvent } from "react";
import dynamic from "next/dynamic";
import type { IntlTelInputRef } from "intl-tel-input/react";
import { COMMUNICATIONS_CONSENT_TEXT, WHATSAPP_CONSENT_TEXT, type LeadField, type LeadFieldErrors, type LeadResponse } from "@/lib/leads/contracts";
import { SITUATIONS, GOALS } from "@/lib/leads/masterclass";
import { trackLeadCreated } from "@/lib/analytics";
import { readLeadAttribution } from "@/lib/leads/attribution";

const PhoneInput = dynamic(() => import("intl-tel-input/reactWithUtils"), { ssr: false });
const PHONE_OPTIONS: ComponentProps<typeof PhoneInput>["initOptions"] = {
  initialCountry: "es" as const, separateDialCode: true, nationalMode: true, strictMode: true,
  countrySearch: true, countryOrder: ["es", "mx", "co", "ve", "ar", "cl", "pe", "ec", "us"],
  validationNumberTypes: ["MOBILE"],
};
const FIELD_STEPS: Record<LeadField, number> = { name: 0, profession: 1, situation: 2, goal: 3, email: 4, phone: 5, whatsappConsent: 5, communicationsConsent: 5 };

export function LeadForm({ onSuccess }: { onSuccess: () => void }) {
  const inFlight = useRef(false);
  const submission = useRef<{ key: string; payload: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const phoneRef = useRef<IntlTelInputRef>(null);
  const choiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [situation, setSituation] = useState("");
  const [goal, setGoal] = useState("");
  const clearPhoneError = useCallback(() => {
    setErrors(current => current.phone ? { ...current, phone: undefined } : current);
  }, []);

  useEffect(() => {
    const target = formRef.current?.querySelector<HTMLElement>(".form-step.active input:not([type=hidden]), .form-step.active .choice");
    target?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => () => { if (choiceTimer.current) clearTimeout(choiceTimer.current); }, []);

  function goTo(next: number) {
    if (choiceTimer.current) clearTimeout(choiceTimer.current);
    setStep(next);
    setErrors({});
    setMessage("");
  }
  function next() {
    const input = formRef.current?.querySelector<HTMLInputElement>(".form-step.active input:not([type=hidden])");
    if (input && (!input.checkValidity() || !input.value.trim())) {
      const field = input.name as LeadField;
      setErrors({ [field]: step === 0 ? "Escribe tu nombre para continuar." : step === 4 ? "Introduce un email válido." : "Completa este campo para continuar." });
      input.focus();
      return;
    }
    goTo(step + 1);
  }
  function choose(field: "situation" | "goal", value: string) {
    if (choiceTimer.current) clearTimeout(choiceTimer.current);
    if (field === "situation") setSituation(value); else setGoal(value);
    setErrors({});
    choiceTimer.current = setTimeout(() => goTo(field === "situation" ? 3 : 4), 160);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 5) { next(); return; }
    if (inFlight.current) return;
    const phone = phoneRef.current?.getInstance();
    if (!phone?.isValidNumberPrecise()) {
      setErrors({ phone: "Introduce un número de móvil válido. No se admiten teléfonos fijos." });
      phoneRef.current?.getInput()?.focus();
      return;
    }
    inFlight.current = true;
    setPending(true);
    setMessage("");
    setErrors({});
    const values = new FormData(event.currentTarget);
    const payload = JSON.stringify({
      name: String(values.get("name") ?? "").trim(), phone: phone.getNumber(),
      email: String(values.get("email") ?? "").trim(), whatsappConsent: values.get("whatsappConsent") === "on",
      communicationsConsent: values.get("communicationsConsent") === "on",
      profession: String(values.get("profession") ?? "").trim(), situation, goal,
      website: String(values.get("website") ?? ""), ...readLeadAttribution(window.location.search),
    });
    if (!submission.current || submission.current.payload !== payload) submission.current = { key: crypto.randomUUID(), payload };
    try {
      const response = await fetch("/api/leads", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": submission.current.key },
        body: payload, signal: AbortSignal.timeout(25_000),
      });
      const result: LeadResponse = await response.json();
      if ((response.status === 200 || response.status === 201) && result.ok === true) {
        if (response.status === 201) trackLeadCreated();
        onSuccess();
      } else {
        setMessage(result.message || "No hemos podido guardar tu solicitud. Vuelve a intentarlo.");
        setErrors(result.fieldErrors ?? {});
        if (response.status === 409) submission.current = null;
        const firstField = Object.keys(result.fieldErrors ?? {})[0] as LeadField | undefined;
        if (firstField && firstField in FIELD_STEPS) {
          setStep(FIELD_STEPS[firstField]);
          requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>(`[name="${firstField}"]`)?.focus());
        }
      }
    } catch {
      setMessage("No hemos podido confirmar tu solicitud. Tus datos siguen aquí; vuelve a intentarlo.");
    } finally { inFlight.current = false; setPending(false); }
  }

  const error = (field: LeadField) => errors[field] ? <div className="field-error" id={`${field}-error`} role="alert">{errors[field]}</div> : null;
  const actions = (back = true, forward = true) => <div className="form-actions">
    {back ? <button className="back-btn" type="button" onClick={() => goTo(step - 1)}>← Atrás</button> : null}
    {forward ? <button className="next-btn" type="button" onClick={next}>Continuar →</button> : null}
  </div>;
  const input = (field: "name" | "profession" | "email", label: string, placeholder: string, type = "text", autoComplete?: string) => <>
    <label htmlFor={field}>{label}</label>
    <input id={field} name={field} type={type} autoComplete={autoComplete} placeholder={placeholder} required
      minLength={field === "name" ? 2 : 1} maxLength={field === "email" ? 254 : field === "profession" ? 200 : 100}
      aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${field}-error` : undefined}
      onInput={() => setErrors({})} />
    {error(field)}
  </>;
  const stepClass = (n: number) => `form-step${step === n ? " active" : ""}`;

  return <div id="lead-form-wrap">
    <div className="form-head">
      <div className="step-count" id="step-count" aria-live="polite">Pregunta {step + 1} de 6</div>
      <div className="progress" role="progressbar" aria-label="Progreso del formulario" aria-valuemin={0} aria-valuemax={6} aria-valuenow={step + 1}>
        <span style={{ width: `${((step + 1) / 6) * 100}%` }} />
      </div>
    </div>
    <form id="lead-form" name="webinar-leads" ref={formRef} onSubmit={submit} noValidate aria-label="Acceso a la masterclass" aria-busy={pending}>
      <fieldset disabled={pending}>
        <legend className="sr-only">Tus datos para acceder a la masterclass</legend>
        <div className={stepClass(0)}>
          <h3>¿Cómo te llamas?</h3><p>Empecemos por lo básico.</p>
          {input("name", "Nombre", "Tu nombre", "text", "given-name")}{actions(false)}
        </div>
        <div className={stepClass(1)}>
          <h3>¿A qué te dedicas?</h3><p>Cuéntanos brevemente cuál es tu actividad profesional.</p>
          {input("profession", "Profesión / actividad", "Ej. ventas, dirección, emprendimiento...")}{actions()}
        </div>
        <div className={stepClass(2)}>
          <h3>¿Cuál describe mejor tu situación actual?</h3><p>Elige la opción que más se aproxime a tu caso.</p>
          <div className="choices">{SITUATIONS.map(value => <button className={`choice${situation === value ? " selected" : ""}`} key={value} type="button" aria-pressed={situation === value} onClick={() => choose("situation", value)}>{value}</button>)}</div>
          {error("situation")}{actions(true, false)}
        </div>
        <div className={stepClass(3)}>
          <h3>¿Qué te gustaría mejorar principalmente?</h3><p>Elige el área que tendría más impacto para ti ahora mismo.</p>
          <div className="choices">{GOALS.map(value => <button className={`choice${goal === value ? " selected" : ""}`} key={value} type="button" aria-pressed={goal === value} onClick={() => choose("goal", value)}>{value}</button>)}</div>
          {error("goal")}{actions(true, false)}
        </div>
        <div className={stepClass(4)}>
          <h3>¿Cuál es tu email?</h3><p>Lo utilizaremos para identificar tu acceso y poder contactar contigo.</p>
          {input("email", "Email", "tu@email.com", "email", "email")}{actions()}
        </div>
        <div className={stepClass(5)}>
          <h3>¿Cuál es tu número de móvil?</h3><p>Último paso. Después se desbloquea directamente la masterclass.</p>
          <label htmlFor="telefono_visible">Móvil / WhatsApp</label>
          <PhoneInput ref={phoneRef} initOptions={PHONE_OPTIONS} disabled={pending} inputProps={{ id: "telefono_visible", type: "tel", inputMode: "tel", autoComplete: "tel-national", placeholder: "600 000 000", required: true, onChange: clearPhoneError, "aria-invalid": !!errors.phone, "aria-describedby": errors.phone ? "phone-error phone-hint" : "phone-hint" }} />
          {error("phone")}
          <div className="phone-hint" id="phone-hint">Selecciona tu país y escribe tu móvil. Se guardará con su prefijo internacional.</div>
          <label className="whatsapp-consent" htmlFor="whatsappConsent"><input id="whatsappConsent" name="whatsappConsent" type="checkbox" /> <span>{WHATSAPP_CONSENT_TEXT} (Opcional)</span></label>
          <label className="whatsapp-consent" htmlFor="communicationsConsent"><input id="communicationsConsent" name="communicationsConsent" type="checkbox" /> <span>{COMMUNICATIONS_CONSENT_TEXT} (Opcional)</span></label>
          <div className="form-actions"><button className="back-btn" type="button" onClick={() => goTo(4)}>← Atrás</button><button className="form-submit" type="submit">{pending ? "DESBLOQUEANDO..." : "DESBLOQUEAR MASTERCLASS →"}</button></div>
        </div>
        <div className="honeypot" aria-hidden="true"><label htmlFor="website">Deja este campo vacío</label><input id="website" name="website" tabIndex={-1} autoComplete="off" maxLength={200} /></div>
      </fieldset>
      <p className="form-message" role="alert">{message}</p>
    </form>
  </div>;
}
