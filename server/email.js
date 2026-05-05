function env(name) {
  return String(process.env[name] || "").trim();
}

function createEmailDeliveryError(message, debug) {
  const error = new Error(message);
  error.publicMessage = message;
  error.debugMessage = debug;
  return error;
}

export async function sendEmailWithFallback({ to, subject, html, fromName = "StagePro Tickets" }) {
  const toEmail = String(to || "").trim();
  if (!toEmail) throw new Error("Recipient email is required");

  const resendKey = env("RESEND_API_KEY");
  const resendFrom = env("RESEND_FROM") || "onboarding@resend.dev";

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
      console.error("Resend delivery failed:", resendErr);
    }
  }

  throw createEmailDeliveryError(
    "Email delivery is temporarily unavailable.",
    `Email delivery failed. Resend: ${resendErr || "not configured"}`
  );
}
