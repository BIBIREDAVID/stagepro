import { sendEmailWithFallback } from "../server/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    recipients = [],
    eventTitle = "StagePro Event",
    eventDate = "",
    eventVenue = "",
    notifTitle = "",
    notifBody = "",
    themeColor = "#f5a623",
  } = req.body || {};

  if (!Array.isArray(recipients) || recipients.length === 0 || !notifTitle || !notifBody) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#0a0a0a;color:#e8e0d0;padding:24px;">
  <div style="max-width:620px;margin:0 auto;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:24px;">
    <h2 style="margin:0 0 10px;color:${themeColor};">${notifTitle}</h2>
    <p style="margin:0 0 16px;color:#ccc;">${notifBody}</p>
    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:12px 14px;">
      <strong>${eventTitle}</strong><br/>
      <span style="color:#aaa;">${eventDate}${eventVenue ? ` • ${eventVenue}` : ""}</span>
    </div>
  </div>
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
