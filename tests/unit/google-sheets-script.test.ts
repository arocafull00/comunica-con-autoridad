import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function fixture(initialRows: string[][] = [["submission_id", "email", "notes"]]) {
  const rows = initialRows.map(row => [...row]);
  const sheet = {
    getLastColumn: () => rows[0].length,
    getLastRow: () => rows.length,
    getRange: (row: number, column: number, height = 1, width = 1) => ({
      getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[column - 1 + j] ?? "")),
      setValues: (values: string[][]) => values.forEach((line, i) => line.forEach((value, j) => {
        rows[row - 1 + i] ??= []; rows[row - 1 + i][column - 1 + j] = value;
      })),
      setValue: (value: string) => { rows[row - 1] ??= []; rows[row - 1][column - 1] = value; },
    }),
  };
  const context = {
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => key === "MASTERCLASS_SPREADSHEET_ID" ? "fixture-id" : null }) },
    SpreadsheetApp: { openById: () => ({ getSheets: () => [sheet] }), flush() {} },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: (body: string) => ({ setMimeType: () => JSON.parse(body) }) },
    doPost: undefined as unknown as (event: { parameter: Record<string, string> }) => { success: boolean; updated?: boolean },
  };
  runInNewContext(readFileSync("scripts/google-sheets-masterclass.gs", "utf8"), context);
  const post = (parameter: Record<string, string>) => context.doPost({ parameter });
  const cell = (field: string) => rows[1][rows[0].indexOf(field)];
  return { post, rows, cell };
}

describe("two-phase Apps Script", () => {
  const contact = { submission_id: "f4a211ab-4bc1-4443-a17f-8fa7534153b7", email: "test@example.com", telefono: "+34612345678" };
  it("updates the same row, keeps unrelated columns and does not erase answers on access replays", () => {
    const { post, rows, cell } = fixture();
    expect(post(contact)).toMatchObject({ success: true, updated: true });
    rows[1][rows[0].indexOf("notes")] = "Manual note";
    expect(post({ ...contact, a_que_te_dedicas: "DEVELOP", que_quiere_mejorar: "Comunicar con más seguridad, autoridad y confianza",
      nivel_compromiso: "Muy alto: estoy dispuesto/a a aplicar, practicar y seguir las indicaciones", rango_inversion: "Menos de 500€",
      razones_para_reservar: "Prueba", decision_admision: "Sí, reservaré la llamada" })).toMatchObject({ success: true, updated: true });
    expect(post(contact)).toMatchObject({ success: true, updated: true });
    expect(rows).toHaveLength(2);
    expect(cell("a_que_te_dedicas")).toBe("DEVELOP");
    expect(cell("que_quiere_mejorar")).toBe("Comunicar con más seguridad, autoridad y confianza");
    expect(cell("nivel_compromiso")).toBe("Muy alto: estoy dispuesto/a a aplicar, practicar y seguir las indicaciones");
    expect(cell("rango_inversion")).toBe("Menos de 500€");
    expect(cell("razones_para_reservar")).toBe("Prueba");
    expect(cell("decision_admision")).toBe("Sí, reservaré la llamada");
    expect(cell("notes")).toBe("Manual note");
  });
  it("writes input as literal text and rejects missing contact metadata", () => {
    const { post, cell, rows } = fixture();
    expect(post({ ...contact, a_que_te_dedicas: "=1+1" }).success).toBe(true);
    expect(cell("a_que_te_dedicas")).toBe("'=1+1");
    expect(post({ ...contact, submission_id: "invalid" }).success).toBe(false);
    expect(rows).toHaveLength(2);
  });
  it("updates an old contact in the original columns and preserves manual I:J data", () => {
    const headers = ["Fecha", "Nombre", "A qué se dedica", "Situación actual", "Qué quiere mejorar", "Email", "Teléfono / WhatsApp", "País", "Notas", "Estado"];
    const { post, rows, cell } = fixture([headers, ["original date", "Nombre original", "", "", "", contact.email, contact.telefono, "ES", "Nota manual", "Pendiente"]]);
    expect(post({ ...contact, a_que_te_dedicas: "DEVELOP", razones_para_reservar: "Prueba", decision_admision: "Sí, reservaré la llamada" })).toMatchObject({ success: true, updated: true });
    expect(post(contact)).toMatchObject({ success: true, updated: true });
    expect(rows).toHaveLength(2);
    expect(rows[0].slice(0, 10)).toEqual(headers);
    expect(rows[1].slice(0, 3)).toEqual(["original date", "Nombre original", "DEVELOP"]);
    expect(rows[1].slice(8, 10)).toEqual(["Nota manual", "Pendiente"]);
    expect(cell("submission_id")).toBe(contact.submission_id);
    expect(cell("razones_para_reservar")).toBe("Prueba");
    expect(cell("decision_admision")).toBe("Sí, reservaré la llamada");
    expect(rows[0]).not.toContain("email");
    expect(rows[0]).not.toContain("telefono");
  });
  it("does not adopt an old row on email alone or overwrite another submission", () => {
    const { post, rows } = fixture([
      ["submission_id", "email", "telefono", "notes"],
      ["", contact.email, "+34699999999", "Different phone"],
      ["other-submission", contact.email, contact.telefono, "Other registration"],
    ]);
    expect(post(contact)).toMatchObject({ success: true, updated: true });
    expect(rows).toHaveLength(4);
    expect(rows[1].slice(0, 4)).toEqual(["", contact.email, "+34699999999", "Different phone"]);
    expect(rows[2].slice(0, 4)).toEqual(["other-submission", contact.email, contact.telefono, "Other registration"]);
    expect(rows[3][0]).toBe(contact.submission_id);
  });
});
