function doPost(e) {
  var payload = {};
  try {
    payload = JSON.parse(e.postData.contents || "{}");
  } catch (err) {
    payload = { raw: e.postData.contents || "" };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var baseName = String(payload.eventTitle || payload.title || "Live Feed").trim();
  var sheetName = baseName.substring(0, 50).replace(/[\/\\?*\[\]:]/g, "") || "Live Feed";
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  var headers = [
    "Created At",
    "Purchased At",
    "Type",
    "Title",
    "Organizer ID",
    "Organizer Name",
    "Event ID",
    "Event Title",
    "Ticket ID",
    "Tier Name",
    "Attendee Name",
    "Attendee Email",
    "Attendee Phone",
    "Amount",
    "Currency",
    "Status",
    "Payment Reference",
    "Payment Provider",
    "Validated By",
    "Source",
    "Notes",
    "Raw JSON"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground("#f5a623")
      .setFontColor("#000000")
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    payload.createdAt || new Date().toISOString(),
    payload.purchasedAt || "",
    payload.type || "",
    payload.title || "",
    payload.organizerId || "",
    payload.organizerName || "",
    payload.eventId || "",
    payload.eventTitle || "",
    payload.ticketId || "",
    payload.tierName || "",
    payload.attendeeName || payload.buyerName || "",
    payload.attendeeEmail || payload.buyerEmail || "",
    payload.attendeePhone || payload.buyerPhone || "",
    payload.amount || "",
    payload.currency || "",
    payload.status || "",
    payload.paymentReference || payload.transferReference || "",
    payload.paymentProvider || "",
    payload.validatedBy || "",
    payload.source || "",
    payload.notes || payload.error || "",
    JSON.stringify(payload)
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
