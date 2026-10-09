export function validWelcomeBody(body: string) {
  return body.trim().length > 0 && body.length <= 1024 &&
    !/[{}]/.test(body.replace("{{1}}", ""));
}

export function validVersionInput(input: unknown): input is { sourceId: string; name: string; body: string } {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return typeof value.sourceId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.sourceId) &&
    typeof value.name === "string" && /^[a-z0-9_]{1,512}$/.test(value.name) &&
    typeof value.body === "string" && validWelcomeBody(value.body);
}

export function nextTemplateName(name: string, names: string[]) {
  const base = name.replace(/_v\d+$/, "").slice(0, 500);
  const existing = new Set(names);
  let version = 2;
  while (existing.has(`${base}_v${version}`)) version++;
  return `${base}_v${version}`;
}
