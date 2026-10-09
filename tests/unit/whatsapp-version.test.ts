import { describe, expect, it } from "vitest";
import { nextTemplateName, validVersionInput } from "../../lib/whatsapp-template-version";
const input = { sourceId: "00000000-0000-4000-8000-000000000001", name: "welcome_v2", body: "Hola {{1}}, recibimos tu solicitud." };

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
});
