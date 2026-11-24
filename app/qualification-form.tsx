"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { GOALS, SITUATIONS } from "@/lib/leads/masterclass";
import type { BookingContact } from "@/lib/leads/booking-validation";
import type { LeadFieldErrors, LeadResponse } from "@/lib/leads/contracts";

type ChoiceField = "situation" | "goal";
type AnswerField = "profession" | ChoiceField;
const CHOICES: { field: ChoiceField; question: string; hint: string; options: readonly string[] }[] = [
  { field: "situation", question: "¿Cuál describe mejor tu situación actual?", hint: "Elige la opción que más se aproxime a tu caso.", options: SITUATIONS },
  { field: "goal", question: "¿Qué te gustaría mejorar principalmente?", hint: "Elige el área que tendría más impacto para ti ahora mismo.", options: GOALS },
];
const STEP_FIELDS: AnswerField[] = ["profession", ...CHOICES.map(choice => choice.field)];
const TOTAL_STEPS = STEP_FIELDS.length;

export function QualificationForm({ contact, onSuccess, onReset }: {
  contact: BookingContact;
  onSuccess: (bookingUrl: string) => void;
  onReset: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const submissionId = useRef("");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ profession: "", situation: "", goal: "" });
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => { formRef.current?.querySelector<HTMLElement>(".form-step.active input")?.focus({ preventScroll: true }); }, [step]);
  function goTo(next: number) { setStep(next); setErrors({}); setMessage(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const field = STEP_FIELDS[step];
    if (!answers[field].trim()) { setErrors({ [field]: "Completa esta pregunta para continuar." }); return; }
    if (step < TOTAL_STEPS - 1) { goTo(step + 1); return; }
    inFlight.current = true; setPending(true); setMessage(""); setErrors({});
    const calendar = window.open("about:blank", "_blank");
    if (calendar) calendar.opener = null;
    let calendarOpened = false;
    try {
      submissionId.current ||= crypto.randomUUID();
      const response = await fetch("/api/leads/qualification", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": submissionId.current },
        body: JSON.stringify({ ...contact, ...answers }), signal: AbortSignal.timeout(25_000),
      });
      const result: LeadResponse = await response.json();
      if (response.ok && result.ok && result.bookingUrl) {
        onSuccess(result.bookingUrl);
        if (calendar && !calendar.closed) {
          try {
            calendar.location.replace(result.bookingUrl);
            calendarOpened = true;
            calendar.focus();
          } catch { /* The calendar link remains available on the page. */ }
        }
      } else {
        setMessage(result.message || "No hemos podido guardar tus respuestas. Vuelve a intentarlo.");
        setErrors(result.fieldErrors ?? {});
        const index = STEP_FIELDS.indexOf(Object.keys(result.fieldErrors ?? {})[0] as AnswerField);
        if (index >= 0) setStep(index);
      }
    } catch { setMessage("No hemos podido confirmar el guardado. Tus respuestas siguen aquí; vuelve a intentarlo."); }
    finally {
      if (!calendarOpened) calendar?.close();
      inFlight.current = false; setPending(false);
    }
  }
  const error = (field: AnswerField) => errors[field] ? <div className="field-error" id={`${field}-error`} role="alert">{errors[field]}</div> : null;
  return <div id="qualification-form-wrap" className="qualification-wrap">
    <div className="form-head">
      <div className="step-count" aria-live="polite">Pregunta {step + 1} de {TOTAL_STEPS}</div>
      <div className="progress" role="progressbar" aria-label="Progreso del formulario" aria-valuemin={0} aria-valuemax={TOTAL_STEPS} aria-valuenow={step + 1}><span style={{ width: `${(step + 1) / TOTAL_STEPS * 100}%` }} /></div>
    </div>
    <form ref={formRef} onSubmit={submit} noValidate aria-label="Preguntas para reservar llamada" aria-busy={pending}>
      <fieldset disabled={pending}>
        <legend className="sr-only">Prepara tu sesión</legend>
        <div className={`form-step${step === 0 ? " active" : ""}`}>
          <h3>¿A qué te dedicas?</h3>
          <p>Cuéntanos brevemente cuál es tu actividad profesional.</p>
          <label htmlFor="profession">Profesión / actividad</label>
          <input id="profession" name="profession" value={answers.profession} maxLength={200} required placeholder="Ej. ventas, dirección, emprendimiento..." aria-invalid={!!errors.profession} aria-describedby={errors.profession ? "profession-error" : undefined} onChange={event => { setAnswers(current => ({ ...current, profession: event.target.value })); setErrors({}); }} />
          {error("profession")}
        </div>
        {CHOICES.map(({ field, question, hint, options }, index) => <div key={field} className={`form-step${step === index + 1 ? " active" : ""}`}>
          <h3 id={`${field}-question`}>{question}</h3>
          <p>{hint}</p>
          <div className="choices" role="radiogroup" aria-labelledby={`${field}-question`} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${field}-error` : undefined}>
            {options.map(value => <label className={`choice choice-radio${answers[field] === value ? " selected" : ""}`} key={value}>
              <input type="radio" name={field} value={value} checked={answers[field] === value} onChange={() => { setAnswers(current => ({ ...current, [field]: value })); setErrors({}); }} /><span>{value}</span>
            </label>)}
          </div>
          {error(field)}
        </div>)}
        <div className="form-actions">
          {step > 0 ? <button className="back-btn" type="button" onClick={() => goTo(step - 1)}>← Atrás</button> : null}
          <button className="next-btn" type="submit">{pending ? "GUARDANDO..." : step === TOTAL_STEPS - 1 ? "Reservar llamada" : "Continuar →"}</button>
        </div>
      </fieldset>
      <p className="form-message" role="alert">{message}</p>
    </form>
    <button className="another-registration-btn" type="button" disabled={pending} onClick={onReset}>Realizar otra inscripción</button>
  </div>;
}
