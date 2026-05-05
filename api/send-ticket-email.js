import { sendEmailWithFallback } from "../server/email.js";
import { buildTicketEmail } from "../server/ticketEmail.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    toEmail,
    toName,
    eventTitle,
    eventDate,
    eventTime,
    eventVenue,
    tierName,
    amountPaid,
    ticketUrl,
    ticketId,
    themeColor,
    organizerName,
    eventImage,
    socialLinks,
  } = req.body || {};

  if (!toEmail || !eventTitle || !ticketUrl) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const message = buildTicketEmail({
    toName,
    eventTitle,
    eventDate,
    eventTime,
    eventVenue,
    tierName,
    amountPaid,
    ticketUrl,
    ticketId,
    themeColor,
    organizerName,
    eventImage,
    socialLinks,
  });

  try {
    const delivery = await sendEmailWithFallback({
      to: toEmail,
      subject: message.subject,
      html: message.html,
      fromName: "StagePro Tickets",
      kind: "ticket",
      meta: {
        ticketId,
        eventTitle,
        tierName,
      },
    });
    return res.status(200).json({ success: true, provider: delivery.provider });
  } catch (err) {
    console.error("Ticket email error:", err);
    return res.status(500).json({
      error: err?.publicMessage || "Could not send ticket email",
      debug: process.env.NODE_ENV === "development" ? (err?.debugMessage || err?.message || "Unknown server error") : undefined,
    });
  }
}
