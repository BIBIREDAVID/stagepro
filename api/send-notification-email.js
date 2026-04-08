import { sendEmailWithFallback } from "../server/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    recipients = [],
    eventTitle = "StagePro Event",
    eventDate = "",
    eventVenue = "",
    eventImage = "",
    notifTitle = "",
    notifBody = "",
    themeColor = "#f5a623",
  } = req.body || {};

  if (!Array.isArray(recipients) || recipients.length === 0 || !notifTitle || !notifBody) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const APP_BASE_URL = (process.env.PUBLIC_APP_URL || "https://stagepro-phi.vercel.app").replace(/\/+$/, "");
  const headerImage = String(eventImage || "").trim() || process.env.EMAIL_HEADER_URL || `${APP_BASE_URL}/email-header-motion-2026.jpg`;
  const safeBody = String(notifBody || "").replace(/\n/g, "<br/>");

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border-radius:20px;overflow:hidden;border:1px solid #2a2a2a;">
        <tr><td style="padding:0;line-height:0;"><img src="${headerImage}" alt="${eventTitle}" width="600" style="display:block;width:100%;max-height:280px;" /></td></tr>
        <tr><td style="background:#1a1a1a;padding:28px 40px;border-bottom:2px solid ${themeColor};">
          <span style="font-size:26px;font-weight:900;color:${themeColor};letter-spacing:6px;">STAGE</span>
          <span style="font-size:26px;font-weight:900;color:#e8e0d0;letter-spacing:6px;">PRO</span>
          <p style="margin:4px 0 0;color:#555;font-size:11px;letter-spacing:2px;">EVENT UPDATE</p>
        </td></tr>
        <tr><td style="padding:32px 40px 16px;">
          <h2 style="margin:0 0 12px;color:#e8e0d0;font-size:24px;">${notifTitle}</h2>
          <p style="margin:0;color:#b8b8b8;font-size:14px;line-height:1.8;">${safeBody}</p>
        </td></tr>
        <tr><td style="padding:8px 40px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:14px;overflow:hidden;border:1px solid #2a2a2a;">
            <tr><td style="padding:20px 24px;border-bottom:1px solid #2a2a2a;">
              <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">EVENT</p>
              <p style="margin:0;font-size:20px;font-weight:800;color:#e8e0d0;">${eventTitle}</p>
            </td></tr>
            <tr><td style="padding:16px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0"><tr>
                <td><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">DATE</p><p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventDate || "See event page"}</p></td>
                <td><p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;">VENUE</p><p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventVenue || "See event page"}</p></td>
              </tr></table>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const results = await Promise.allSettled(
    recipients.map(({ email }) =>
      sendEmailWithFallback({
        to: email,
        subject: `${notifTitle} - ${eventTitle}`,
        html,
        fromName: "StagePro",
      })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  const firstErr = results.find((r) => r.status === "rejected");

  if (sent === 0) {
    return res.status(500).json({
      error: "Could not deliver notification emails",
      debug: firstErr?.status === "rejected" ? String(firstErr.reason?.message || "") : "",
      sent,
      failed,
    });
  }

  return res.status(200).json({ success: true, sent, failed });
}
