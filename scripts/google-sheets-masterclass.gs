// Deploy in the Apps Script project backing the existing spreadsheet.
// Set Script Properties MASTERCLASS_SPREADSHEET_ID and (optionally) MASTERCLASS_SHEET_NAME.
function doPost(event) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var data = event.parameter;
    var fields = ["submission_id", "nombre", "a_que_te_dedicas", "situacion_actual", "que_quiere_mejorar", "email", "telefono", "telefono_pais", "telefono_prefijo", "nivel_compromiso", "rango_inversion"];
    if (!/^[0-9a-f-]{36}$/i.test(data.submission_id || "") || !data.email || !data.telefono) {
      return masterclassResponse({ success: false });
    }
    var properties = PropertiesService.getScriptProperties();
    var spreadsheet = SpreadsheetApp.openById(properties.getProperty("MASTERCLASS_SPREADSHEET_ID"));
    var sheetName = properties.getProperty("MASTERCLASS_SHEET_NAME");
    var sheet = sheetName ? spreadsheet.getSheetByName(sheetName) : spreadsheet.getSheets()[0];
    if (!sheet) throw new Error("Sheet not found");
    var headers = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
    fields.forEach(function (field) {
      if (headers.indexOf(field) < 0) headers.push(field);
    });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    var idColumn = headers.indexOf("submission_id") + 1;
    var row = 0;
    if (sheet.getLastRow() > 1) {
      var ids = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).toLowerCase() === data.submission_id.toLowerCase()) { row = i + 2; break; }
      }
    }
    var duplicate = row > 0;
    if (!row) row = sheet.getLastRow() + 1;
    // Preserve columns outside this form and do not erase answers on contact replays.
    fields.forEach(function (field) {
      var value = String(data[field] || "");
      if (duplicate && !value) return;
      if (/^[=+@-]/.test(value)) value = "'" + value;
      sheet.getRange(row, headers.indexOf(field) + 1).setValue(value);
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
