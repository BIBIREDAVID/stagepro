// api/send-notification-email.js
// Sends a notification email to all ticket holders for an event

import nodemailer from "nodemailer";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_PASS;
  if (!GMAIL_USER || !GMAIL_PASS) return res.status(500).json({ error: "Email not configured" });

  const { recipients, eventTitle, eventDate, eventVenue, notifTitle, notifBody, eventImage, themeColor } = req.body;

  if (!recipients?.length || !notifTitle || !notifBody) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const accent = themeColor || "#f5a623";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border-radius:20px;overflow:hidden;border:1px solid #2a2a2a;">

  ${eventImage ? `<tr><td style="padding:0;line-height:0;"><img src="${eventImage}" width="600" style="display:block;width:100%;max-height:200px;object-fit:cover;border-radius:20px 20px 0 0;" /></td></tr>` : ""}

  <!-- Header -->
  <tr><td style="background:#1a1a1a;padding:24px 40px;border-bottom:2px solid ${accent};">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <span style="font-size:22px;font-weight:900;color:${accent};letter-spacing:6px;">STAGE</span><span style="font-size:22px;font-weight:900;color:#e8e0d0;letter-spacing:6px;">PRO</span>
        <p style="margin:4px 0 0;color:#555;font-size:11px;letter-spacing:2px;">MESSAGE FROM ORGANISER</p>
      </td>
      <td align="right">
        <span style="background:rgba(245,166,35,0.15);color:${accent};border:1px solid ${accent};padding:5px 12px;border-radius:100px;font-size:11px;font-weight:700;">EVENT UPDATE</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- Event badge -->
  <tr><td style="padding:24px 40px 0;">
    <div style="background:#1a1a1a;border-radius:10px;padding:14px 18px;border-left:3px solid ${accent};margin-bottom:8px;">
      <p style="margin:0 0 3px;font-size:10px;color:#555;letter-spacing:2px;">EVENT</p>
      <p style="margin:0;font-size:17px;font-weight:800;color:#e8e0d0;">${eventTitle}</p>
      ${eventDate ? `<p style="margin:4px 0 0;font-size:12px;color:#777;">${eventDate}${eventVenue ? ` · ${eventVenue}` : ""}</p>` : ""}
    </div>
  </td></tr>

  <!-- Notification content -->
  <tr><td style="padding:24px 40px;">
    <h2 style="margin:0 0 14px;color:#e8e0d0;font-size:22px;line-height:1.3;">${notifTitle}</h2>
    <p style="margin:0;color:#999;font-size:15px;line-height:1.8;">${notifBody}</p>
  </td></tr>

  <!-- Divider -->
  <tr><td style="padding:0 40px 24px;">
    <div style="height:1px;background:#2a2a2a;"></div>
  </td></tr>

  <!-- CTA -->
  <tr><td align="center" style="padding:0 40px 32px;">
    <a href="https://stagepro-phi.vercel.app" style="display:inline-block;background:${accent};color:#000;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:1px;">VIEW EVENT</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 40px;border-top:1px solid #1e1e1e;">
    <p style="margin:0;font-size:11px;color:#444;line-height:1.7;">
      You received this because you have a ticket for ${eventTitle}. 
      Questions? <a href="mailto:${GMAIL_USER}" style="color:${accent};text-decoration:none;">${GMAIL_USER}</a>
    </p>
    <p style="margin:6px 0 0;font-size:11px;color:#333;">© 2025 StagePro · stagepro-phi.vercel.app</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    // Send to all recipients
    const results = await Promise.allSettled(
      recipients.map(({ email, name }) =>
        transporter.sendMail({
          from: `"StagePro" <${GMAIL_USER}>`,
          to: email,
          subject: `${notifTitle} — ${eventTitle}`,
          html: html.replace("Hey there", `Hey ${name || "there"}`),
        })
      )
    );

    const sent = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    return res.status(200).json({ success: true, sent, failed });
  } catch (err) {
    console.error("Notification email error:", err);
    return res.status(500).json({ error: err.message });
  }
}
