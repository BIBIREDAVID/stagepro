import nodemailer from "nodemailer";

function env(name) {
  return String(process.env[name] || "").trim();
}

export async function sendEmailWithFallback({ to, subject, html, fromName = "StagePro Tickets" }) {
  const toEmail = String(to || "").trim();
  if (!toEmail) throw new Error("Recipient email is required");

  const gmailUser = env("GMAIL_USER");
  const gmailPass = env("GMAIL_PASS");
  const resendKey = env("RESEND_API_KEY");
  const resendFrom = env("RESEND_FROM") || gmailUser || "onboarding@resend.dev";

  let gmailErr = "";
  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmailUser, pass: gmailPass },
      });
      await transporter.sendMail({
        from: `"${fromName}" <${gmailUser}>`,
        to: toEmail,
        subject,
        html,
      });
      return { ok: true, provider: "gmail" };
    } catch (err) {
      gmailErr = String(err?.message || err || "");
    }
  }

  let resendErr = "";
  if (resendKey) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [toEmail],
          subject,
          html,
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(payload?.message || `Resend send failed with ${resp.status}`);
      }
      return { ok: true, provider: "resend" };
    } catch (err) {
      resendErr = String(err?.message || err || "");
    }
  }

  throw new Error(
    `Email delivery failed. Gmail: ${gmailErr || "not configured"}; Resend: ${resendErr || "not configured"}`
  );
}
