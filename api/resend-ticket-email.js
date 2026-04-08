import { getAdminDb } from "../server/firebaseAdmin.js";
import { sendEmailWithFallback } from "../server/email.js";
import { buildTicketEmail } from "../server/ticketEmail.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { ticketId } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: "ticketId required" });

  try {
    const ticketDoc = await getAdminDb().collection("tickets").doc(ticketId).get();
    if (!ticketDoc.exists) return res.status(404).json({ error: "Ticket not found" });

    const f = ticketDoc.data() || {};
    const toEmail = String(f.userEmail || "").trim();
    if (!toEmail) return res.status(400).json({ error: "No email on ticket" });

    const price = Number(f.price || 0);
    const amountPaid = price === 0 ? "FREE" : `₦${price.toLocaleString()}`;
    const appBaseUrl = (process.env.PUBLIC_APP_URL || "https://stagepro-phi.vercel.app").replace(/\/+$/, "");
    const ticketUrl = `${appBaseUrl}/ticket/${ticketId}`;
    const formattedDate = f.eventDate
      ? new Date(f.eventDate).toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
      : "See event page";

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
      organizerName: "StagePro",
      eventImage: f.eventImage || "",
    });

    const delivery = await sendEmailWithFallback({
      to: toEmail,
      subject: `${message.subject} (Resent)`,
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
