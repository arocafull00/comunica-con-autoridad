import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, requireAdmin, revalidatePath } = vi.hoisted(() => ({ rpc: vi.fn(), requireAdmin: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/session", () => ({ getSupabaseSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/admin/validation", async () => await import("../../lib/admin/validation"));
vi.mock("@/lib/leads/request", () => ({ requestIpHash: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
import { saveWhatsappSettings } from "../../app/admin/actions";

beforeEach(() => { vi.clearAllMocks(); requireAdmin.mockResolvedValue({ user: { id: "admin" }, db: { rpc } }); });
describe("fixed-message administration", () => {
  it("rejects a crafted template edit after removing its controls from the panel", async () => {
    const form = new FormData(); form.set("intent", "template"); form.set("templateId", "00000000-0000-4000-8000-000000000001");
    expect(await saveWhatsappSettings({ message: "" }, form)).toMatchObject({ message: expect.stringContaining("son fijos") });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("applies only delivery even when a caller injects a template ID", async () => {
    rpc.mockResolvedValue({ data: { outcome: "saved" }, error: null });
    const form = new FormData(); form.set("intent", "delivery"); form.set("enabled", "on"); form.set("revision", "7"); form.set("templateId", "injected");
    expect(await saveWhatsappSettings({ message: "" }, form)).toMatchObject({ success: true });
    expect(rpc).toHaveBeenCalledWith("set_whatsapp_delivery", { p_actor: "admin", p_revision: 7, p_enabled: true });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/whatsapp");
  });
});
