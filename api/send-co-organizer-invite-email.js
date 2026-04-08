import { getAdminDb } from "../server/firebaseAdmin.js";
import { sendEmailWithFallback } from "../server/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const sendEmail = req.body?.sendEmail !== false;
  const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const eventId = String(req.body?.eventId || "").trim();
  const eventTitle = String(req.body?.eventTitle || "").trim();
  const senderName = String(req.body?.senderName || "StagePro Organizer").trim();
  const origin = String(req.body?.origin || "").trim();
  const base = origin.startsWith("http")
    ? origin.replace(/\/+$/, "")
    : "https://stagepro-phi.vercel.app";
  const eventUrl = `${base}/event/${eventId}`;

  const uniqueRecipients = recipients
    .map((recipient) => ({
      email: String(recipient?.email || "").trim().toLowerCase(),
      uid: String(recipient?.uid || "").trim() || null,
    }))
    .filter((recipient) => recipient.email)
    .filter((recipient, index, all) => all.findIndex((row) => row.email === recipient.email) === index);

  if (!eventId || !eventTitle || uniqueRecipients.length === 0) {
    return res.status(400).json({ ok: false, msg: "Missing required fields" });
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:30px 16px;background:#0a0a0a;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:22px 26px;border-bottom:2px solid #f5a623;background:#1a1a1a;">
          <span style="font-size:22px;font-weight:900;color:#f5a623;letter-spacing:4px;">STAGE</span>
          <span style="font-size:22px;font-weight:900;color:#e8e0d0;letter-spacing:4px;">PRO</span>
          <p style="margin:6px 0 0;color:#666;font-size:11px;letter-spacing:2px;">CO-ORGANIZER INVITE</p>
        </td></tr>
        <tr><td style="padding:24px 26px;">
          <h2 style="margin:0 0 10px;color:#e8e0d0;font-size:22px;">You were added as a co-organizer</h2>
          <p style="margin:0;color:#999;line-height:1.8;font-size:14px;">
            <strong style="color:#e8e0d0;">${senderName}</strong> added this email as a co-organizer for
            <strong style="color:#f5a623;">${eventTitle}</strong>.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:8px 26px 24px;">
          <a href="${eventUrl}" style="display:inline-block;background:#f5a623;color:#000;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:800;font-size:14px;letter-spacing:1px;">OPEN EVENT</a>
          <p style="margin:12px 0 0;color:#666;font-size:11px;">If you do not have an account yet, sign up with this same email to activate access.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    let emailResults = [];
    if (sendEmail) {
      emailResults = await Promise.allSettled(
        uniqueRecipients.map((recipient) =>
          sendEmailWithFallback({
            to: recipient.email,
            subject: `Co-organizer invite - ${eventTitle}`,
            html,
            fromName: "StagePro",
          })
        )
      );
    }

    let inAppSent = 0;
    let inAppFailed = 0;
    try {
      const db = getAdminDb();
      const inAppResults = await Promise.allSettled(
        uniqueRecipients
          .filter((recipient) => recipient.uid)
          .map((recipient) =>
            db.collection("organizerNotifications").add({
              organizerId: recipient.uid,
              eventId,
              eventTitle,
              type: "co_organizer_invite",
              title: "You were added as a co-organizer",
              body: `You can now manage "${eventTitle}" from your organizer dashboard.`,
              createdAt: new Date().toISOString(),
            })
          )
      );
      inAppSent = inAppResults.filter((result) => result.status === "fulfilled").length;
      inAppFailed = inAppResults.filter((result) => result.status === "rejected").length;
    } catch (inAppErr) {
      console.warn("Could not write co-organizer in-app notifications:", inAppErr);
      inAppFailed = uniqueRecipients.filter((recipient) => recipient.uid).length;
    }

    const sent = emailResults.filter((result) => result.status === "fulfilled").length;
    const failed = emailResults.filter((result) => result.status === "rejected").length;
    const firstEmailError = emailResults.find((result) => result.status === "rejected");
    const firstEmailErrorMsg = firstEmailError?.status === "rejected"
      ? String(firstEmailError.reason?.debugMessage || firstEmailError.reason?.message || "Unknown email error")
      : "";

    const anyDelivered = sent > 0 || inAppSent > 0;
    if (!anyDelivered) {
      return res.status(500).json({
        ok: false,
        msg: "No co-organizer notifications were delivered",
        sent,
        failed,
        inAppSent,
        inAppFailed,
        debug: process.env.NODE_ENV === "development" ? (firstEmailErrorMsg || "No invite was delivered") : undefined,
      });
    }

    return res.status(200).json({
      ok: true,
      sent,
      failed,
      inAppSent,
      inAppFailed,
      debug: process.env.NODE_ENV === "development" ? (firstEmailErrorMsg || "") : undefined,
    });
  } catch (err) {
    console.error("Co-organizer invite email error:", err);
    return res.status(500).json({
      ok: false,
      msg: err?.publicMessage || "Could not send invite emails",
      debug: process.env.NODE_ENV === "development" ? String(err?.debugMessage || err?.message || "") : undefined,
    });
  }
}
