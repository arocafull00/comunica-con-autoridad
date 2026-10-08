type MetaTemplate = {
  name?: string; language?: string; status?: string; parameter_format?: string;
  components?: { type?: string; text?: string }[];
};
export type ApprovedTemplate = { name: string; language: string; body: string };

// The welcome worker supplies exactly one positional name parameter, and no media or buttons.
export function compatibleTemplates(templates: MetaTemplate[]): ApprovedTemplate[] {
  return templates.filter((template) => template?.status === "APPROVED" &&
    /^[a-z0-9_]{1,512}$/.test(template.name ?? "") && /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language ?? "") &&
    template.parameter_format !== "NAMED" && Array.isArray(template.components) && template.components.length === 1 && template.components[0]?.type === "BODY" &&
    typeof template.components[0].text === "string" &&
    JSON.stringify(template.components[0].text.match(/\{\{[^}]+\}\}/g)) === JSON.stringify(["{{1}}"])
  ).map((template) => ({ name: template.name!, language: template.language!, body: template.components![0].text! }));
}

export async function fetchTemplates({ token, wabaId, version }: { token: string; wabaId: string; version: string }, fetcher: typeof fetch = fetch) {
  if (!token || !/^\d+$/.test(wabaId) || !/^v\d+\.\d+$/.test(version)) throw new Error("Missing template sync configuration");
  const all: MetaTemplate[] = [];
  const signal = AbortSignal.timeout(30_000);
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const url = new URL(`https://graph.facebook.com/${version}/${wabaId}/message_templates`);
    url.searchParams.set("fields", "name,language,status,parameter_format,components");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) throw new Error("Meta catalog request failed");
    const body = await response.json();
    if (!Array.isArray(body.data)) throw new Error("Unexpected Meta catalog response");
    all.push(...body.data);
    if (!body.paging?.next) {
      const templates = compatibleTemplates(all);
      if (templates.length > 1000) throw new Error("Catalog too large");
      return templates;
    }
    after = body.paging.cursors?.after;
    if (typeof after !== "string" || !after) throw new Error("Missing catalog cursor");
  }
  throw new Error("Catalog pagination limit reached");
}
