import crypto from "crypto";
import { getAdminDb } from "../server/firebaseAdmin.js";
import { sendEmailWithFallback } from "../server/email.js";

const ACCESS_WINDOW_MS = 1000 * 60 * 20;

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payload, secret) {
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

async function fetchTicketCountByEmail(email) {
  const db = getAdminDb();
  const snap = await db.collection("tickets").where("userEmail", "==", email.toLowerCase()).limit(1).get();
  return snap.size;
}

async function fetchTicketsByEmail(email) {
  const db = getAdminDb();
  const snap = await db.collection("tickets").where("userEmail", "==", email.toLowerCase()).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const accessSecret = process.env.TICKET_ACCESS_SECRET;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const originFromBody = String(req.body?.origin || "").trim();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ ok: false, msg: "A valid email address is required" });
  }

  try {
    const ticketCount = await fetchTicketCountByEmail(email);
    if (ticketCount === 0) {
      return res.status(200).json({ ok: true, msg: "If tickets exist for this email, a secure link has been sent." });
    }

    if (!accessSecret) {
      const tickets = await fetchTicketsByEmail(email);
      return res.status(200).json({
        ok: true,
        mode: "direct",
        email,
        tickets,
        msg: "Email delivery is currently unavailable. Showing your tickets directly.",
      });
    }

    const payload = { email, exp: Date.now() + ACCESS_WINDOW_MS };
    const token = signPayload(payload, accessSecret);
    const inferredOrigin = originFromBody.startsWith("http")
      ? originFromBody
      : `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
    const accessUrl = `${inferredOrigin.replace(/\/$/, "")}/find-tickets?access=${encodeURIComponent(token)}`;

    const html = `<!DOCTYPE html>
<html lang="en"><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border-radius:20px;overflow:hidden;border:1px solid #2a2a2a;">
<tr><td style="background:#1a1a1a;padding:28px 40px;border-bottom:2px solid #f5a623;">
<span style="font-size:26px;font-weight:900;color:#f5a623;letter-spacing:4px;">STAGE</span><span style="font-size:26px;font-weight:900;color:#e8e0d0;letter-spacing:4px;">PRO</span>
<p style="margin:4px 0 0;color:#666;font-size:11px;letter-spacing:2px;">SECURE TICKET ACCESS</p>
</td></tr>
<tr><td style="padding:32px 40px 12px;">
<h2 style="margin:0 0 12px;color:#e8e0d0;font-size:24px;">View your tickets</h2>
<p style="margin:0;color:#999;font-size:14px;line-height:1.8;">Use the secure link below to open tickets linked to <strong style="color:#e8e0d0;">${email}</strong>. This link expires in 20 minutes.</p>
</td></tr>
<tr><td align="center" style="padding:20px 40px 32px;">
<a href="${accessUrl}" style="display:inline-block;background:#f5a623;color:#000;text-decoration:none;padding:16px 38px;border-radius:12px;font-weight:800;font-size:16px;letter-spacing:1px;">VIEW MY TICKETS</a>
</td></tr>
</table></td></tr></table></body></html>`;

    await sendEmailWithFallback({
      to: email,
      subject: "Your secure StagePro ticket access link",
      html,
      fromName: "StagePro Tickets",
    });

    return res.status(200).json({ ok: true, mode: "email", msg: "If tickets exist for this email, a secure link has been sent." });
  } catch (err) {
    console.error("Ticket access link error:", err);
    try {
      const tickets = await fetchTicketsByEmail(email);
      if (tickets.length > 0) {
        return res.status(200).json({
          ok: true,
          mode: "direct",
          email,
          tickets,
          msg: "We could not send email right now. Showing your tickets directly.",
        });
      }
    } catch (fallbackErr) {
      console.error("Ticket access direct fallback error:", fallbackErr);
    }
    return res.status(500).json({ ok: false, msg: "Could not send the access email", debug: err?.message || "Unknown server error" });
  }
}
