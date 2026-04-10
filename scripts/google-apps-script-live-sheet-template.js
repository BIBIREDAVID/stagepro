function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Live Feed") || SpreadsheetApp.getActiveSpreadsheet().insertSheet("Live Feed");

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Created At",
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
      "Amount",
      "Currency",
      "Payment Reference",
      "Payment Provider",
      "Notes",
      "Raw JSON"
    ]);
  }

  var payload = {};
  try {
    payload = JSON.parse(e.postData.contents || "{}");
  } catch (err) {
    payload = { raw: e.postData.contents || "" };
  }

  sheet.appendRow([
    payload.createdAt || new Date().toISOString(),
    payload.type || "",
    payload.title || "",
    payload.organizerId || "",
    payload.organizerName || "",
    payload.eventId || "",
    payload.eventTitle || "",
    payload.ticketId || "",
    payload.tierName || "",
    payload.attendeeName || "",
    payload.attendeeEmail || "",
    payload.amount || "",
    payload.currency || "",
    payload.paymentReference || payload.transferReference || "",
    payload.paymentProvider || "",
    payload.notes || payload.error || "",
    JSON.stringify(payload)
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
