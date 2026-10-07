// Accept only approved, body-only templates with exactly one positional name parameter.
export function compatibleTemplates(templates) {
  return templates.filter((template) => template.status === "APPROVED" &&
    /^[a-z0-9_]{1,512}$/.test(template.name ?? "") && /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language ?? "") &&
    template.parameter_format !== "NAMED" && template.components?.length === 1 && template.components[0].type === "BODY" &&
    typeof template.components[0].text === "string" &&
    JSON.stringify(template.components[0].text.match(/\{\{[^}]+\}\}/g)) === JSON.stringify(["{{1}}"])
  ).map((template) => ({ name: template.name, language: template.language, body: template.components[0].text }));
}
export async function fetchTemplates({ token, wabaId, version }, fetcher = fetch) {
  if (!token || !/^\d+$/.test(wabaId ?? "") || !/^v\d+\.\d+$/.test(version ?? "")) throw new Error("Configure WHATSAPP_ACCESS_TOKEN, WHATSAPP_WABA_ID and WHATSAPP_GRAPH_API_VERSION for this command");
  const all = []; let after;
  for (let page = 0; page < 100; page++) {
    const url = new URL(`https://graph.facebook.com/${version}/${wabaId}/message_templates`);
    url.searchParams.set("fields", "name,language,status,parameter_format,components");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Meta rejected catalog request (HTTP ${response.status})`);
    const body = await response.json();
    if (!Array.isArray(body.data)) throw new Error("Unexpected Meta catalog response");
    all.push(...body.data);
    if (!body.paging?.next) return compatibleTemplates(all);
    after = body.paging.cursors?.after;
    if (!after) throw new Error("Missing catalog pagination cursor");
  }
  throw new Error("Catalog pagination limit reached; no local changes applied");
}
