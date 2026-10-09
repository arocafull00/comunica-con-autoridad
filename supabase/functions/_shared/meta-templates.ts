type MetaTemplate = {
  id?: string; category?: string; name?: string; language?: string; status?: string; parameter_format?: string;
  components?: { type?: string; text?: string }[];
};
export type CatalogTemplate = { name: string; language: string; body: string; meta_status: string; approved: boolean; category: string; meta_id: string | null; components: NonNullable<MetaTemplate["components"]> };

// Welcome sends support fixed text or one positional name parameter, and no media or buttons.
export function catalogTemplates(templates: MetaTemplate[]): CatalogTemplate[] {
  return templates.map((template) => {
    if (!template || !/^[a-z0-9_]{1,512}$/.test(template.name ?? "") || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language ?? "") ||
      !/^[A-Z_]{1,64}$/.test(template.status ?? "") || !Array.isArray(template.components)) throw new Error("Unexpected Meta template");
    const body = template.components.find((component) => component?.type === "BODY")?.text ?? "";
    if (typeof body !== "string") throw new Error("Unexpected Meta template body");
    // `approved` retains the existing worker contract: approved AND usable for welcome sends.
    const approved = template.status === "APPROVED" && template.parameter_format !== "NAMED" &&
      template.components.length === 1 && template.components[0]?.type === "BODY" &&
      body.trim().length > 0 && body.length <= 4096 && !/[{}]/.test(body.replace("{{1}}", ""));
    return { name: template.name!, language: template.language!, body, meta_status: template.status!, approved, components: template.components,
      category: template.category ?? "UNKNOWN", meta_id: template.id ?? null };
  });
}

export async function fetchTemplates({ token, wabaId, version }: { token: string; wabaId: string; version: string }, fetcher: typeof fetch = fetch) {
  if (!token || !/^\d+$/.test(wabaId) || !/^v\d+\.\d+$/.test(version)) throw new Error("Missing template sync configuration");
  const all: MetaTemplate[] = [];
  const signal = AbortSignal.timeout(30_000);
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const url = new URL(`https://graph.facebook.com/${version}/${wabaId}/message_templates`);
    url.searchParams.set("fields", "id,name,language,status,category,parameter_format,components");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) throw new Error("Meta catalog request failed");
    const body = await response.json();
    if (!Array.isArray(body.data)) throw new Error("Unexpected Meta catalog response");
    all.push(...body.data);
    if (all.length > 1000) throw new Error("Catalog too large");
    if (!body.paging?.next) {
      return catalogTemplates(all);
    }
    after = body.paging.cursors?.after;
    if (typeof after !== "string" || !after) throw new Error("Missing catalog cursor");
  }
  throw new Error("Catalog pagination limit reached");
}
