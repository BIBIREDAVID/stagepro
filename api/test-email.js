// api/test-email.js — visit /api/test-email?to=your@email.com to test
// DELETE this file after confirming emails work

import nodemailer from "nodemailer";

export default async function handler(req, res) {
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_PASS;

  if (!GMAIL_USER || !GMAIL_PASS) {
    return res.status(500).json({
      error: "Gmail credentials not set",
      fix: "Add GMAIL_USER and GMAIL_PASS to Vercel environment variables"
    });
  }

  const toEmail = req.query.to || GMAIL_USER;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    await transporter.sendMail({
      from: `"StagePro" <${GMAIL_USER}>`,
      to: toEmail,
      subject: "StagePro Email Test",
      html: `<div style="background:#111;color:#e8e0d0;padding:40px;font-family:Arial;border-radius:12px;max-width:500px;margin:0 auto;"><h1 style="color:#f5a623;">StagePro</h1><p>Email is working! Sent to: <strong>${toEmail}</strong></p></div>`,
    });

    return res.status(200).json({ success: true, sentTo: toEmail });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
