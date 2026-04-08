import { getAdminDb } from "../server/firebaseAdmin.js";
import { sendEmailWithFallback } from "../server/email.js";

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

    const toName = f.userName || "there";
    const eventTitle = f.eventTitle || "StagePro Event";
    const eventDate = f.eventDate || "";
    const eventTime = f.eventTime || "TBA";
    const eventVenue = f.venue || "See event page";
    const tierName = f.tierName || "General";
    const price = Number(f.price || 0);
    const amountPaid = price === 0 ? "FREE" : `₦${price.toLocaleString()}`;
    const appBaseUrl = (process.env.PUBLIC_APP_URL || "https://stagepro-phi.vercel.app").replace(/\/+$/, "");
    const ticketUrl = `${appBaseUrl}/ticket/${ticketId}`;
    const formattedDate = eventDate
      ? new Date(eventDate).toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
      : "See event page";

    const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#0a0a0a;color:#e8e0d0;padding:24px;">
  <div style="max-width:620px;margin:0 auto;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:24px;">
    <h2 style="margin:0 0 12px;color:#f5a623;">Your ticket has been resent</h2>
    <p>Hi ${toName}, here is your ticket for <strong>${eventTitle}</strong>.</p>
    <p><strong>Date:</strong> ${formattedDate}<br/><strong>Time:</strong> ${eventTime}<br/><strong>Venue:</strong> ${eventVenue}</p>
    <p><strong>Tier:</strong> ${tierName}<br/><strong>Amount Paid:</strong> ${amountPaid}</p>
    <p><a href="${ticketUrl}" style="display:inline-block;padding:12px 20px;background:#f5a623;color:#000;text-decoration:none;border-radius:10px;font-weight:700;">View Ticket</a></p>
    <p style="font-size:12px;color:#999;">Ticket ID: ${ticketId}</p>
  </div>
</body></html>`;

    const delivery = await sendEmailWithFallback({
      to: toEmail,
      subject: `Your ticket for ${eventTitle} - StagePro (Resent)`,
      html,
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
