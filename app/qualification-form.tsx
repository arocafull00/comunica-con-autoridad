"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ADMISSION_DECISIONS, BOOKING_GOALS, COMMITMENTS, INVESTMENTS } from "@/lib/leads/masterclass";
import type { LeadFieldErrors, LeadResponse } from "@/lib/leads/contracts";

type ChoiceField = "goal" | "commitment" | "investment";
type AnswerField = "profession" | ChoiceField | "applicationReasons" | "admissionDecision";
const QUESTIONS = [
  "¿Qué es lo que más te gustaría mejorar en tu comunicación?",
  "Nuestras formaciones son prácticas y exigentes, y requieren implicación real para obtener resultados. ¿Qué nivel de compromiso tendrías con el proceso?",
  "Para ajustar la estrategia de la sesión a tu realidad actual y recomendarte la herramienta o programa adecuado para ti, ¿en qué rango de inversión te sientes más cómodo hoy?",
];
const OPTIONS = [BOOKING_GOALS, COMMITMENTS, INVESTMENTS];
const FIELDS: ChoiceField[] = ["goal", "commitment", "investment"];
const STEP_FIELDS: AnswerField[] = ["profession", ...FIELDS, "applicationReasons", "admissionDecision"];
const TOTAL_STEPS = STEP_FIELDS.length;

export function QualificationForm({ accessToken, onSuccess, onExpired }: {
  accessToken: string; onSuccess: (bookingUrl?: string) => void; onExpired: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ profession: "", goal: "", commitment: "", investment: "", applicationReasons: "", admissionDecision: ADMISSION_DECISIONS[0] as typeof ADMISSION_DECISIONS[number] });
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => { formRef.current?.querySelector<HTMLElement>(".form-step.active input, .form-step.active textarea")?.focus({ preventScroll: true }); }, [step]);
  function goTo(next: number) { setStep(next); setErrors({}); setMessage(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const field = STEP_FIELDS[step];
    if (!answers[field].trim()) { setErrors({ [field]: "Completa esta pregunta para continuar." }); return; }
    if (step < TOTAL_STEPS - 1) { goTo(step + 1); return; }
    inFlight.current = true; setPending(true); setMessage(""); setErrors({});
    try {
      const response = await fetch("/api/leads/qualification", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(answers), signal: AbortSignal.timeout(25_000),
      });
      const result: LeadResponse = await response.json();
      if (response.ok && result.ok && (result.bookingUrl || answers.admissionDecision === ADMISSION_DECISIONS[1])) {
        onSuccess(answers.admissionDecision === ADMISSION_DECISIONS[0] ? result.bookingUrl : undefined);
      }
      else if (response.status === 401) onExpired();
      else {
        setMessage(result.message || "No hemos podido guardar tus respuestas. Vuelve a intentarlo.");
        setErrors(result.fieldErrors ?? {});
        const first = Object.keys(result.fieldErrors ?? {})[0];
        const index = STEP_FIELDS.indexOf(first as AnswerField);
        if (index >= 0) setStep(index);
      }
    } catch { setMessage("No hemos podido confirmar el guardado. Tus respuestas siguen aquí; vuelve a intentarlo."); }
    finally { inFlight.current = false; setPending(false); }
  }
  const error = (field: keyof typeof answers) => errors[field] ? <div className="field-error" id={`${field}-error`} role="alert">{errors[field]}</div> : null;
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
          <label htmlFor="profession">Profesión / actividad</label>
          <input id="profession" name="profession" value={answers.profession} maxLength={200} required placeholder="Ej. ventas, dirección, emprendimiento..." aria-invalid={!!errors.profession} aria-describedby={errors.profession ? "profession-error" : undefined} onChange={event => { setAnswers(current => ({ ...current, profession: event.target.value })); setErrors({}); }} />
          {error("profession")}
        </div>
        {FIELDS.map((field, index) => <div key={field} className={`form-step${step === index + 1 ? " active" : ""}`}>
          <h3 id={`${field}-question`}>{QUESTIONS[index]}</h3>
          <div className="choices" role="radiogroup" aria-labelledby={`${field}-question`} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${field}-error` : undefined}>
            {OPTIONS[index].map(value => <label className={`choice choice-radio${answers[field] === value ? " selected" : ""}`} key={value}>
              <input type="radio" name={field} value={value} checked={answers[field] === value} onChange={() => { setAnswers(current => ({ ...current, [field]: value })); setErrors({}); }} /><span>{value}</span>
            </label>)}
          </div>
          {error(field)}
        </div>)}
        <div className={`form-step${step === 4 ? " active" : ""}`}>
          <h3>¿Qué tiene de especial tu caso para que Ignacio lo considere por encima de cientos de casos que aplican diariamente? Danos 3 razones para reservar tu plaza.</h3>
          <label htmlFor="applicationReasons">Tus 3 razones</label>
          <textarea id="applicationReasons" name="applicationReasons" value={answers.applicationReasons} maxLength={2000} rows={7} required placeholder="Cuéntanos las tres razones..." aria-invalid={!!errors.applicationReasons} aria-describedby={errors.applicationReasons ? "applicationReasons-error" : undefined} onChange={event => { setAnswers(current => ({ ...current, applicationReasons: event.target.value })); setErrors({}); }} />
          {error("applicationReasons")}
        </div>
        <div className={`form-step${step === 5 ? " active" : ""}`}>
          <h3 id="admissionDecision-question">Nos tomamos muy en serio este proceso de selección. Ten en cuenta que esto es una llamada de admisión; si solo quieres información, no agendes la reunión. ¿Estás de acuerdo?</h3>
          <div className="choices" role="radiogroup" aria-labelledby="admissionDecision-question" aria-invalid={!!errors.admissionDecision} aria-describedby={errors.admissionDecision ? "admissionDecision-error" : undefined}>
            {ADMISSION_DECISIONS.map(value => <label className={`choice choice-radio${answers.admissionDecision === value ? " selected" : ""}`} key={value}>
              <input type="radio" name="admissionDecision" value={value} checked={answers.admissionDecision === value} onChange={() => { setAnswers(current => ({ ...current, admissionDecision: value })); setErrors({}); }} /><span>{value}</span>
            </label>)}
          </div>
          {error("admissionDecision")}
        </div>
        <div className="form-actions">
          {step > 0 ? <button className="back-btn" type="button" onClick={() => goTo(step - 1)}>← Atrás</button> : null}
          <button className="next-btn" type="submit">{pending ? "GUARDANDO..." : step === TOTAL_STEPS - 1 && answers.admissionDecision
            ? answers.admissionDecision === ADMISSION_DECISIONS[0] ? "Reservar llamada" : "No reservaré llamada"
            : "Continuar →"}</button>
        </div>
      </fieldset>
      <p className="form-message" role="alert">{message}</p>
    </form>
  </div>;
}
