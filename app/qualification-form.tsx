"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CAL_BOOKING_URL, GOALS, SITUATIONS } from "@/lib/leads/masterclass";
import type { LeadFieldErrors, LeadResponse } from "@/lib/leads/contracts";
import { trackFunnel, type FunnelEvent } from "@/lib/funnel";

type ChoiceField = "situation" | "goal";
type AnswerField = "profession" | ChoiceField;
const CHOICES: { field: ChoiceField; question: string; hint: string; options: readonly string[] }[] = [
  { field: "situation", question: "¿Cuál describe mejor tu situación actual?", hint: "Elige la opción que más se aproxime a tu caso.", options: SITUATIONS },
  { field: "goal", question: "¿Qué te gustaría mejorar principalmente?", hint: "Elige el área que tendría más impacto para ti ahora mismo.", options: GOALS },
];
const STEP_FIELDS: AnswerField[] = ["profession", ...CHOICES.map(choice => choice.field)];
const TOTAL_STEPS = STEP_FIELDS.length;

function saveProgress(accessToken: string, step: number, answers: Record<string, string>) {
  trackFunnel(`question_${step + 1}` as FunnelEvent);
  const draft = Object.fromEntries(Object.entries(answers).filter(([, value]) => value.trim()));
  void fetch("/api/leads/progress", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ step: step + 1, answers: draft }), keepalive: true,
  }).catch(() => {});
}

// Questions after the contact step. Name, email, mobile and consents are already saved.
export function QualificationForm({ accessToken, onSuccess, onExpired }: {
  accessToken: string; onSuccess: (bookingUrl?: string) => void; onExpired: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ profession: "", situation: "", goal: "" });
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => { formRef.current?.querySelector<HTMLElement>(".form-step.active input")?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => { saveProgress(accessToken, 0, {}); }, [accessToken]);
  function goTo(next: number) { setStep(next); setErrors({}); setMessage(""); saveProgress(accessToken, next, answers); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const field = STEP_FIELDS[step];
    if (!answers[field].trim()) { setErrors({ [field]: "Completa esta pregunta para continuar." }); return; }
    if (step < TOTAL_STEPS - 1) { goTo(step + 1); return; }
    inFlight.current = true; setPending(true); setMessage(""); setErrors({});
    const calendar = window.open("about:blank", "_blank");
    if (calendar) { calendar.opener = null; calendar.location.replace(CAL_BOOKING_URL); }
    let calendarOpened = false;
    try {
      const response = await fetch("/api/leads/qualification", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(answers), signal: AbortSignal.timeout(25_000),
      });
      const result: LeadResponse = await response.json();
      if (response.ok && result.ok && result.bookingUrl) {
        if (calendar && !calendar.closed) {
          if (result.bookingUrl !== CAL_BOOKING_URL) calendar.location.replace(result.bookingUrl);
          calendar.focus();
          calendarOpened = true;
        }
        trackFunnel("form_completed");
        trackFunnel("calendar_open");
        onSuccess(result.bookingUrl);
      }
      else if (response.status === 401) onExpired();
      else {
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
  </div>;
}
