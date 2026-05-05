import { getAdminDb } from "../server/firebaseAdmin.js";
import { sendEmailWithFallback } from "../server/email.js";
import { buildTicketEmail } from "../server/ticketEmail.js";
import { getAppBaseUrl } from "../server/appUrl.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { ticketId } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: "ticketId required" });

  try {
    const db = getAdminDb();
    const ticketDoc = await db.collection("tickets").doc(ticketId).get();
    if (!ticketDoc.exists) return res.status(404).json({ error: "Ticket not found" });

    const f = ticketDoc.data() || {};
    const toEmail = String(f.userEmail || "").trim();
    if (!toEmail) return res.status(400).json({ error: "No email on ticket" });

    const price = Number(f.price || 0);
    const amountPaid = price === 0 ? "FREE" : `NGN ${price.toLocaleString()}`;
    const appBaseUrl = getAppBaseUrl(req);
    const ticketUrl = `${appBaseUrl}/ticket/${ticketId}`;
    const formattedDate = f.eventDate
      ? new Date(f.eventDate).toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
      : "See event page";

    let organizerName = "StagePro";
    let eventImage = String(f.eventImage || "").trim();
    if (f.eventId) {
      const eventDoc = await db.collection("events").doc(String(f.eventId)).get();
      if (eventDoc.exists) {
        const event = eventDoc.data() || {};
        if (!eventImage) eventImage = String(event.image || "").trim();
        if (event.organizer) {
          const organizerDoc = await db.collection("users").doc(String(event.organizer)).get();
          if (organizerDoc.exists) {
            organizerName = String(organizerDoc.data()?.name || "").trim() || organizerName;
          }
        }
      }
    }

    const message = buildTicketEmail({
      toName: f.userName || "there",
      eventTitle: f.eventTitle || "StagePro Event",
      eventDate: formattedDate,
      eventTime: f.eventTime || "TBA",
      eventVenue: f.venue || "See event page",
      tierName: f.tierName || "General",
      amountPaid,
      ticketUrl,
      ticketId,
      themeColor: "#f5a623",
      organizerName,
      eventImage,
      appBaseUrl,
    });

    const delivery = await sendEmailWithFallback({
      to: toEmail,
      subject: `Resent Ticket ${ticketId} for ${f.eventTitle || "StagePro Event"} - StagePro`,
      html: message.html,
      fromName: "StagePro Tickets",
    });

    return res.status(200).json({ success: true, sentTo: toEmail, provider: delivery.provider });
  } catch (err) {
    console.error("Resend ticket error:", err);
    return res.status(500).json({
      error: err?.publicMessage || "Could not resend ticket email",
      debug: process.env.NODE_ENV === "development" ? (err?.debugMessage || err?.message || "Unknown server error") : undefined,
    });
  }
}
