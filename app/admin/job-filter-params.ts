export const JOB_STATUSES = [
  { value: "pending", label: "Pendiente" },
  { value: "processing", label: "Procesando" },
  { value: "sent", label: "Enviado" },
  { value: "failed", label: "Fallido" },
  { value: "suppressed", label: "Omitido" },
] as const;

export type JobFilterSearchParams = { page?: string; perPage?: string; status?: string; step?: string; order?: string };

export function jobFilterParams(params: JobFilterSearchParams, steps: readonly string[]) {
  const status = JOB_STATUSES.find((option) => option.value === params.status)?.value ?? "";
  const step = steps.includes(params.step ?? "") ? params.step! : "";
  const order: "asc" | "desc" = params.order === "asc" ? "asc" : "desc";
  const query: Record<string, string> = {};
  if (status) query.status = status;
  if (step) query.step = step;
  if (order === "asc") query.order = order;
  return { status, step, order, query };
}
