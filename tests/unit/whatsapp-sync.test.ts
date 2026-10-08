import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, getSession, revalidatePath } = vi.hoisted(() => ({ requireAdmin: vi.fn(), getSession: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/session", () => ({ authConfiguration: () => ({ url: "https://db.example.com", key: "public-key" }) }));
vi.mock("next/cache", () => ({ revalidatePath }));
import { syncWhatsappTemplates } from "../../app/admin/whatsapp-sync-action";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ session: { auth: { getSession } } });
  getSession.mockResolvedValue({ data: { session: { access_token: "user-token" } }, error: null });
});

describe("dashboard template sync", () => {
  it("requires active admin access before invoking the function", async () => {
    requireAdmin.mockRejectedValue(new Error("redirect to login"));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(syncWhatsappTemplates({ message: "" })).rejects.toThrow("redirect to login");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends the verified user's token to the function and refreshes the catalog", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ count: 2 })); vi.stubGlobal("fetch", fetcher);
    expect(await syncWhatsappTemplates({ message: "" })).toEqual({ success: true, message: "2 plantillas aprobadas sincronizadas." });
    expect(fetcher).toHaveBeenCalledWith("https://db.example.com/functions/v1/sync-whatsapp-templates", expect.objectContaining({ method: "POST", cache: "no-store", headers: { apikey: "public-key", Authorization: "Bearer user-token" } }));
    expect(revalidatePath).toHaveBeenCalledWith("/admin/whatsapp");
  });
  it("reports a valid empty catalog and refreshes removed options", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ count: 0 })));
    expect(await syncWhatsappTemplates({ message: "" })).toMatchObject({ success: true, message: expect.stringContaining("No hay plantillas") });
    expect(revalidatePath).toHaveBeenCalled();
  });
  it("reports missing configuration and Meta failures without leaking their responses", async () => {
    for (const [status, error, text] of [[503, "sync_not_configured", "no está configurada"], [502, "meta_catalog_unavailable", "catálogo anterior"], [403, "forbidden", "verificar tu acceso"]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error, token: "private-token" }, { status })));
      const result = await syncWhatsappTemplates({ message: "" });
      expect(result.success).toBeUndefined(); expect(result.message).toContain(text);
      expect(result.message).not.toContain("private-token");
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
