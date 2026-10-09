import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function fixture() {
  const rows: string[][] = [["submission_id", "email", "notes"]];
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
    expect(post({ ...contact, a_que_te_dedicas: "Dirección", nivel_compromiso: "Alto", rango_inversion: "Menos de 500€" })).toMatchObject({ success: true, updated: true });
    expect(post(contact)).toMatchObject({ success: true, updated: true });
    expect(rows).toHaveLength(2);
    expect(cell("a_que_te_dedicas")).toBe("Dirección");
    expect(cell("nivel_compromiso")).toBe("Alto");
    expect(cell("notes")).toBe("Manual note");
  });
  it("writes input as literal text and rejects missing contact metadata", () => {
    const { post, cell, rows } = fixture();
    expect(post({ ...contact, a_que_te_dedicas: "=1+1" }).success).toBe(true);
    expect(cell("a_que_te_dedicas")).toBe("'=1+1");
    expect(post({ ...contact, submission_id: "invalid" }).success).toBe(false);
    expect(rows).toHaveLength(2);
  });
});
