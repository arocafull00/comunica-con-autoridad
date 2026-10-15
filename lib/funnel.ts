export const QUALIFICATION_STEP_LABELS = ["Profesión", "Situación", "Qué quiere mejorar"] as const;

export const FUNNEL_STEPS = [
  { event: "visit", label: "Entran a la clase" },
  { event: "video_play", label: "Empiezan el vídeo" },
  { event: "video_25", label: "Ven el 25 % del vídeo" },
  { event: "video_50", label: "Ven el 50 % del vídeo" },
  { event: "video_75", label: "Ven el 75 % del vídeo" },
  { event: "video_complete", label: "Terminan el vídeo" },
  { event: "booking_open", label: "Pulsan «Agendar llamada»" },
  { event: "contact_saved", label: "Dejan sus datos" },
  ...QUALIFICATION_STEP_LABELS.map((label, index) => ({ event: `question_${index + 1}`, label: `Pregunta ${index + 1} · ${label}` })),
  { event: "form_completed", label: "Completan el formulario" },
  { event: "calendar_open", label: "Abren el calendario" },
] as const;

export type FunnelEvent = "visit" | "video_play" | "video_25" | "video_50" | "video_75" | "video_complete" | "booking_open"
  | "contact_saved" | `question_${1 | 2 | 3 | 4 | 5 | 6 | 7}` | "form_completed" | "calendar_open";
export const FUNNEL_EVENTS = FUNNEL_STEPS.map(step => step.event as FunnelEvent);

let sessionId = "";
const sent = new Set<FunnelEvent>();

export function trackFunnel(event: FunnelEvent) {
  if (sent.has(event)) return;
  sent.add(event);
  try {
    sessionId ||= crypto.randomUUID();
    void fetch("/api/funnel", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, event }), keepalive: true,
    }).catch(() => {});
  } catch {}
}
