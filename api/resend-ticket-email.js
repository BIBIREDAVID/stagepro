// api/resend-ticket-email.js
// POST { ticketId } — resends the confirmation email for a ticket

import nodemailer from "nodemailer";
import { getAdminDb } from "../server/firebaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_PASS;
  if (!GMAIL_USER || !GMAIL_PASS) return res.status(500).json({ error: "Email not configured" });

  const { ticketId } = req.body;
  if (!ticketId) return res.status(400).json({ error: "ticketId required" });

  try {
    const ticketDoc = await getAdminDb().collection("tickets").doc(ticketId).get();
    if (!ticketDoc.exists) return res.status(404).json({ error: "Ticket not found" });
    const f = ticketDoc.data() || {};

    const toEmail = f.userEmail;
    const toName = f.userName || "there";
    const eventTitle = f.eventTitle || "";
    const eventDate = f.eventDate || "";
    const eventTime = f.eventTime || "";
    const eventVenue = f.venue || "";
    const tierName = f.tierName || "";
    const price = Number(f.price || 0);
    const amountPaid = price === 0 ? "FREE" : `₦${price.toLocaleString()}`;
    const APP_BASE_URL = (process.env.PUBLIC_APP_URL || "https://stagepro-phi.vercel.app").replace(/\/+$/, "");
    const headerImage = process.env.EMAIL_HEADER_URL || `${APP_BASE_URL}/email-header-motion-2026.jpg`;
    const ticketUrl = `${APP_BASE_URL}/ticket/${ticketId}`;
    const accent = "#f5a623";

    if (!toEmail) return res.status(400).json({ error: "No email on ticket" });

    const formattedDate = eventDate
      ? new Date(eventDate).toLocaleDateString("en-NG", { weekday:"long", year:"numeric", month:"long", day:"numeric" })
      : "See event page";

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border-radius:20px;overflow:hidden;border:1px solid #2a2a2a;">

  <tr><td style="padding:0;line-height:0;"><img src="${headerImage}" alt="${eventTitle}" width="600" style="display:block;width:100%;max-height:280px;object-fit:cover;" /></td></tr>

  <tr><td style="background:#1a1a1a;padding:28px 40px;border-bottom:2px solid ${accent};">
    <span style="font-size:26px;font-weight:900;color:${accent};letter-spacing:6px;">STAGE</span>
    <span style="font-size:26px;font-weight:900;color:#e8e0d0;letter-spacing:6px;">PRO</span>
    <p style="margin:4px 0 0;color:#555;font-size:11px;letter-spacing:2px;">TICKET RESENT</p>
  </td></tr>

  <tr><td style="padding:32px 40px 0;">
    <h2 style="margin:0 0 10px;color:#e8e0d0;font-size:22px;">Hey ${toName},</h2>
    <p style="margin:0;color:#777;font-size:14px;line-height:1.8;">Here is your ticket for <strong style="color:${accent};">${eventTitle}</strong> as requested.</p>
  </td></tr>

  <tr><td style="padding:24px 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:14px;overflow:hidden;border:1px solid #2a2a2a;">
      <tr><td style="padding:20px 24px;border-bottom:1px solid #2a2a2a;">
        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">EVENT</p>
        <p style="margin:0;font-size:20px;font-weight:800;color:#e8e0d0;">${eventTitle}</p>
      </td></tr>
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="padding:16px 24px;border-right:1px solid #2a2a2a;width:33%;"><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">DATE</p><p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${formattedDate}</p></td>
          <td style="padding:16px 24px;border-right:1px solid #2a2a2a;width:33%;"><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">TIME</p><p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventTime || "TBA"}</p></td>
          <td style="padding:16px 24px;width:33%;"><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">VENUE</p><p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventVenue}</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid #2a2a2a;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">TIER</p><p style="margin:0;font-size:14px;color:#e8e0d0;font-weight:600;">${tierName}</p></td>
          <td align="right"><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">AMOUNT PAID</p><p style="margin:0;font-size:20px;font-weight:800;color:${accent};">${amountPaid}</p></td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:0 40px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border-radius:14px;border:2px solid ${accent};">
      <tr><td align="center" style="padding:32px;">
        <p style="margin:0 0 20px;font-size:10px;color:#555;letter-spacing:3px;">YOUR ENTRY QR CODE</p>
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(ticketUrl)}&bgcolor=0a0a0a&color=f5a623&format=png&margin=8" width="220" height="220" alt="QR Code" style="display:block;border-radius:8px;margin:0 auto;" />
        <p style="margin:16px 0 4px;font-size:11px;color:#555;">Ticket ID</p>
        <p style="margin:0;font-size:12px;color:#777;font-family:monospace;">${ticketId}</p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td align="center" style="padding:0 40px 32px;">
    <a href="${ticketUrl}" style="display:inline-block;background:${accent};color:#000;text-decoration:none;padding:16px 48px;border-radius:12px;font-weight:800;font-size:16px;letter-spacing:2px;">VIEW MY TICKET</a>
  </td></tr>

  <tr><td style="padding:24px 40px;border-top:1px solid #1e1e1e;">
    <p style="margin:0;font-size:11px;color:#333;">© 2025 StagePro · stagepro-phi.vercel.app</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    await transporter.sendMail({
      from: `"StagePro Tickets" <${GMAIL_USER}>`,
      to: toEmail,
      subject: `Your ticket for ${eventTitle} — StagePro (Resent)`,
      html,
    });

    return res.status(200).json({ success: true, sentTo: toEmail });
  } catch (err) {
    console.error("Resend ticket error:", err);
    return res.status(500).json({ error: err.message });
  }
}
