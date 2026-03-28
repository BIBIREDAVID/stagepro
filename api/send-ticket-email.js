// api/send-ticket-email.js
// Vercel serverless function — sends ticket confirmation emails via Gmail + Nodemailer

import nodemailer from "nodemailer";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_PASS;

  if (!GMAIL_USER || !GMAIL_PASS) {
    return res.status(500).json({ error: "Gmail credentials not configured" });
  }

  const {
    toEmail, toName,
    eventTitle, eventDate, eventTime, eventVenue,
    tierName, amountPaid,
    ticketUrl, ticketId,
    eventImage, themeColor, organizerName,
  } = req.body;

  if (!toEmail || !eventTitle || !ticketUrl) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const isFree = amountPaid === "FREE" || amountPaid === "₦0";
  const accent = themeColor || "#f5a623";
  const orgName = organizerName || "StagePro";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Your StagePro Ticket</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border-radius:20px;overflow:hidden;border:1px solid #2a2a2a;">

        ${eventImage ? `<tr><td style="padding:0;line-height:0;"><img src="${eventImage}" alt="${eventTitle}" width="600" style="display:block;width:100%;max-height:280px;object-fit:cover;" /></td></tr>` : ""}

        <tr>
          <td style="background:#1a1a1a;padding:28px 40px;border-bottom:2px solid ${accent};">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td><span style="font-size:26px;font-weight:900;color:${accent};letter-spacing:6px;">STAGE</span><span style="font-size:26px;font-weight:900;color:#e8e0d0;letter-spacing:6px;">PRO</span><p style="margin:4px 0 0;color:#555;font-size:11px;letter-spacing:2px;">TICKET CONFIRMATION</p></td>
              <td align="right"><span style="background:rgba(245,166,35,0.15);color:${accent};border:1px solid ${accent};padding:6px 14px;border-radius:100px;font-size:12px;font-weight:700;">${isFree ? "FREE EVENT" : "CONFIRMED ✓"}</span></td>
            </tr></table>
          </td>
        </tr>

        <tr><td style="padding:32px 40px 0;">
          <h2 style="margin:0 0 10px;color:#e8e0d0;font-size:22px;">Hey ${toName || "there"},</h2>
          <p style="margin:0;color:#777;font-size:14px;line-height:1.8;">${isFree ? `Your registration for <strong style="color:${accent};">${eventTitle}</strong> is confirmed by <strong style="color:#e8e0d0;">${orgName}</strong>.` : `Your ticket for <strong style="color:${accent};">${eventTitle}</strong> presented by <strong style="color:#e8e0d0;">${orgName}</strong> is confirmed.`}</p>
        </td></tr>

        <tr><td style="padding:24px 40px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:14px;overflow:hidden;border:1px solid #2a2a2a;">
            <tr><td style="padding:20px 24px;border-bottom:1px solid #2a2a2a;">
              <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">EVENT</p>
              <p style="margin:0;font-size:20px;font-weight:800;color:#e8e0d0;">${eventTitle}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#555;">Presented by ${orgName}</p>
            </td></tr>
            <tr><td>
              <table width="100%" cellpadding="0" cellspacing="0"><tr>
                <td style="padding:16px 24px;border-right:1px solid #2a2a2a;width:33%;"><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">DATE</p><p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventDate || "See event page"}</p></td>
                <td style="padding:16px 24px;border-right:1px solid #2a2a2a;width:33%;"><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">TIME</p><p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventTime || "TBA"}</p></td>
                <td style="padding:16px 24px;width:33%;"><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">VENUE</p><p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventVenue || "See event page"}</p></td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:16px 24px;border-top:1px solid #2a2a2a;">
              <table width="100%" cellpadding="0" cellspacing="0"><tr>
                <td><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">TIER</p><p style="margin:0;font-size:14px;color:#e8e0d0;font-weight:600;">${tierName || "General"}</p></td>
                <td align="right"><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">AMOUNT PAID</p><p style="margin:0;font-size:20px;font-weight:800;color:${isFree ? "#3ddc84" : accent};">${amountPaid}</p></td>
              </tr></table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 40px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border-radius:14px;border:2px solid ${accent};">
            <tr><td align="center" style="padding:32px;">
              <p style="margin:0 0 20px;font-size:10px;color:#555;letter-spacing:3px;">YOUR ENTRY QR CODE</p>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(ticketUrl)}&bgcolor=0a0a0a&color=${accent.replace("#","")}&format=png&margin=8" width="220" height="220" alt="QR Code" style="display:block;border-radius:8px;margin:0 auto;" />
              <p style="margin:16px 0 4px;font-size:11px;color:#555;">Ticket ID</p>
              <p style="margin:0;font-size:12px;color:#777;font-family:monospace;">${ticketId || ""}</p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td align="center" style="padding:0 40px 32px;">
          <a href="${ticketUrl}" style="display:inline-block;background:${accent};color:#000000;text-decoration:none;padding:16px 48px;border-radius:12px;font-weight:800;font-size:16px;letter-spacing:2px;">VIEW MY TICKET</a>
          <p style="margin:14px 0 0;font-size:11px;color:#444;line-height:1.6;">Or open: <a href="${ticketUrl}" style="color:${accent};word-break:break-all;">${ticketUrl}</a></p>
        </td></tr>

        <tr><td style="padding:0 40px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#161616;border-radius:12px;border:1px solid #222;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 10px;font-size:10px;color:#555;letter-spacing:2px;">AT THE VENUE</p>
              <p style="margin:0 0 6px;font-size:13px;color:#777;">✦ Open this email or your ticket link on your phone</p>
              <p style="margin:0 0 6px;font-size:13px;color:#777;">✦ Turn your screen brightness all the way up</p>
              <p style="margin:0;font-size:13px;color:#777;">✦ Present the QR code to the scanner at the entrance</p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 40px;border-top:1px solid #1e1e1e;">
          <p style="margin:0 0 8px;font-size:12px;color:#444;">Questions? <a href="mailto:${GMAIL_USER}" style="color:${accent};text-decoration:none;">${GMAIL_USER}</a></p>
          <p style="margin:0;font-size:11px;color:#333;">© 2025 StagePro · Made in Nigeria · stagepro-phi.vercel.app</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"StagePro Tickets" <${GMAIL_USER}>`,
      to: toEmail,
      subject: `Your ticket for ${eventTitle} — StagePro`,
      html,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Nodemailer error:", err);
    return res.status(500).json({ error: err.message });
  }
}
