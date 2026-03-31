import crypto from "crypto";
import nodemailer from "nodemailer";

const DEFAULT_PROJECT_ID = "stagepro-327e8";
const ACCESS_WINDOW_MS = 1000 * 60 * 20;

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payload, secret) {
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

async function fetchTicketsByEmail(email) {
  const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "tickets" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "userEmail" },
            op: "EQUAL",
            value: { stringValue: email.toLowerCase() },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error("Could not look up tickets");
  }

  const rows = await response.json();
  return rows.filter(row => row.document).length;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_PASS;
  const ACCESS_SECRET = process.env.TICKET_ACCESS_SECRET;
  if (!GMAIL_USER || !GMAIL_PASS || !ACCESS_SECRET) {
    return res.status(500).json({ ok: false, msg: "Ticket access email is not configured" });
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  const originFromBody = String(req.body?.origin || "").trim();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ ok: false, msg: "A valid email address is required" });
  }

  try {
    const ticketCount = await fetchTicketsByEmail(email);
    if (ticketCount === 0) {
      return res.status(200).json({ ok: true, msg: "If tickets exist for this email, a secure link has been sent." });
    }

    const payload = {
      email,
      exp: Date.now() + ACCESS_WINDOW_MS,
    };
    const token = signPayload(payload, ACCESS_SECRET);
    const inferredOrigin = originFromBody.startsWith("http")
      ? originFromBody
      : `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
    const accessUrl = `${inferredOrigin.replace(/\/$/, "")}/find-tickets?access=${encodeURIComponent(token)}`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Access Your StagePro Tickets</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border-radius:20px;overflow:hidden;border:1px solid #2a2a2a;">
        <tr><td style="background:#1a1a1a;padding:28px 40px;border-bottom:2px solid #f5a623;">
          <span style="font-size:26px;font-weight:900;color:#f5a623;letter-spacing:4px;">STAGE</span>
          <span style="font-size:26px;font-weight:900;color:#e8e0d0;letter-spacing:4px;">PRO</span>
          <p style="margin:4px 0 0;color:#666;font-size:11px;letter-spacing:2px;">SECURE TICKET ACCESS</p>
        </td></tr>
        <tr><td style="padding:32px 40px 12px;">
          <h2 style="margin:0 0 12px;color:#e8e0d0;font-size:24px;">View your tickets</h2>
          <p style="margin:0;color:#999;font-size:14px;line-height:1.8;">
            We received a request to access tickets linked to <strong style="color:#e8e0d0;">${email}</strong>.
            Use the secure link below to open them. This link expires in 20 minutes.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:20px 40px 32px;">
          <a href="${accessUrl}" style="display:inline-block;background:#f5a623;color:#000;text-decoration:none;padding:16px 38px;border-radius:12px;font-weight:800;font-size:16px;letter-spacing:1px;">VIEW MY TICKETS</a>
          <p style="margin:16px 0 0;font-size:11px;color:#666;line-height:1.7;">
            If the button does not work, open this link:<br />
            <a href="${accessUrl}" style="color:#f5a623;word-break:break-all;">${accessUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:24px 40px;border-top:1px solid #1e1e1e;">
          <p style="margin:0;font-size:11px;color:#555;line-height:1.7;">
            If you did not request this, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await transporter.sendMail({
      from: `"StagePro Tickets" <${GMAIL_USER}>`,
      to: email,
      subject: "Your secure StagePro ticket access link",
      html,
    });

    return res.status(200).json({ ok: true, msg: "If tickets exist for this email, a secure link has been sent." });
  } catch (err) {
    console.error("Ticket access link error:", err);
    return res.status(500).json({ ok: false, msg: "Could not send the access email" });
  }
}
