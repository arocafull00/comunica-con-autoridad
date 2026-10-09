import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTemplateName, validVersionInput } from "../../lib/whatsapp-template-version";
const { requireAdmin, getSession, revalidatePath } = vi.hoisted(() => ({ requireAdmin: vi.fn(), getSession: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/session", () => ({ authConfiguration: () => ({ url: "https://db.example.com", key: "public-key" }) }));
vi.mock("next/cache", () => ({ revalidatePath }));
import { createWhatsappTemplateVersion } from "../../app/admin/whatsapp-version-action";
const input = { sourceId: "00000000-0000-4000-8000-000000000001", name: "welcome_v2", body: "Hola {{1}}, recibimos tu solicitud." };
const form = () => { const data = new FormData(); for (const [key, value] of Object.entries(input)) data.set(key, value); return data; };
beforeEach(() => { vi.clearAllMocks(); requireAdmin.mockResolvedValue({ session: { auth: { getSession } } }); getSession.mockResolvedValue({ data: { session: { access_token: "user-token" } }, error: null }); });
describe("template version editor", () => {
  it("suggests a distinct version name while preserving the base", () => {
    expect(nextTemplateName("welcome_v1", ["welcome_v1", "welcome_v2"])).toBe("welcome_v3");
    expect(nextTemplateName("welcome", ["welcome"])).toBe("welcome_v2");
  });
  it("validates the name parameter, length and source identity", () => {
    expect(validVersionInput(input)).toBe(true);
    expect(validVersionInput({ ...input, body: "Hola, bienvenida." })).toBe(true);
    for (const body of ["", "   ", "Hola {{1}} {{2}}", "Hola {{1}} {{1}}", "Hola {1}", `{{1}}${"x".repeat(1024)}`]) expect(validVersionInput({ ...input, body })).toBe(false);
    expect(validVersionInput({ ...input, sourceId: "bad" })).toBe(false);
  });
  it("rejects unauthorized actions before calling the function", async () => {
    requireAdmin.mockRejectedValue(new Error("login")); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(createWhatsappTemplateVersion({ message: "" }, form())).rejects.toThrow("login"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("submits only source identity, new name and body, then refreshes the catalog", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ name: input.name, status: "PENDING", stored: true })); vi.stubGlobal("fetch", fetcher);
    expect(await createWhatsappTemplateVersion({ message: "" }, form())).toMatchObject({ success: true, message: expect.stringContaining("plantilla de envío no ha cambiado") });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input); expect(revalidatePath).toHaveBeenCalledWith("/admin/whatsapp");
  });
  it("reports uncertain submissions without claiming failure or suggesting an immediate retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret")));
    expect(await createWhatsappTemplateVersion({ message: "" }, form())).toEqual({ message: "No se pudo confirmar si Meta creó la nueva versión. Sincroniza el catálogo antes de volver a enviarla." });
  });
  it("accepted templates with failed local persistence are recovered with sync rather than another creation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ name: input.name, status: "PENDING", stored: false })));
    expect(await createWhatsappTemplateVersion({ message: "" }, form())).toMatchObject({ success: true, message: expect.stringContaining("Sincroniza el catálogo") });
  });
});
