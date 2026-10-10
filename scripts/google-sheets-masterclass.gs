// Deploy in the Apps Script project backing the existing spreadsheet.
// Script Properties can override the existing spreadsheet and its first sheet.
var MASTERCLASS_SPREADSHEET_ID = "1Weiq5KpBvCXErAJO0ga3LbDS04-pS9XA9xLgRUzi9Jg";
function doPost(event) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var data = event.parameter;
    var fields = ["submission_id", "nombre", "a_que_te_dedicas", "situacion_actual", "que_quiere_mejorar", "email", "telefono", "telefono_pais", "telefono_prefijo", "nivel_compromiso", "rango_inversion", "razones_para_reservar", "decision_admision"];
    if (!/^[0-9a-f-]{36}$/i.test(data.submission_id || "") || !data.email || !data.telefono) {
      return masterclassResponse({ success: false });
    }
    var properties = PropertiesService.getScriptProperties();
    var spreadsheet = SpreadsheetApp.openById(properties.getProperty("MASTERCLASS_SPREADSHEET_ID") || MASTERCLASS_SPREADSHEET_ID);
    var sheetName = properties.getProperty("MASTERCLASS_SHEET_NAME");
    var sheet = sheetName ? spreadsheet.getSheetByName(sheetName) : spreadsheet.getSheets()[0];
    if (!sheet) throw new Error("Sheet not found");
    var headers = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
    // Reuse the original A:H headers and append new columns after existing data.
    var aliases = { nombre: "Nombre", a_que_te_dedicas: "A qué se dedica", situacion_actual: "Situación actual",
      que_quiere_mejorar: "Qué quiere mejorar", email: "Email", telefono: "Teléfono / WhatsApp", telefono_pais: "País" };
    var columns = {};
    fields.forEach(function (field) {
      var index = headers.indexOf(field);
      if (index < 0 && aliases[field]) index = headers.indexOf(aliases[field]);
      if (index < 0) { index = headers.length; headers.push(field); }
      columns[field] = index + 1;
    });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    var idColumn = columns.submission_id;
    var row = 0;
    if (sheet.getLastRow() > 1) {
      var ids = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).toLowerCase() === data.submission_id.toLowerCase()) { row = i + 2; break; }
      }
      // Adopt an old row only when BOTH contact values match and it has no ID.
      // Later registrations with their own IDs remain separate.
      if (!row) {
        var contacts = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
        for (var j = contacts.length - 1; j >= 0; j--) {
          var existing = contacts[j];
          if (!existing[idColumn - 1]
            && String(existing[columns.email - 1]).trim().toLowerCase() === String(data.email).trim().toLowerCase()
            && String(existing[columns.telefono - 1]).replace(/\D/g, "") === String(data.telefono).replace(/\D/g, "")) {
            row = j + 2; break;
          }
        }
      }
    }
    var duplicate = row > 0;
    if (!row) row = sheet.getLastRow() + 1;
    if (!duplicate && headers.indexOf("Fecha") >= 0) sheet.getRange(row, headers.indexOf("Fecha") + 1).setValue(new Date());
    // Preserve columns outside this form and do not erase answers on contact replays.
    fields.forEach(function (field) {
      var value = String(data[field] || "");
      if (duplicate && !value) return;
      if (/^[=+@-]/.test(value)) value = "'" + value;
      sheet.getRange(row, columns[field]).setValue(value);
    });
    SpreadsheetApp.flush();
    return masterclassResponse({ success: true, duplicate: duplicate, updated: true });
  } catch (error) {
    return masterclassResponse({ success: false });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
function masterclassResponse(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
