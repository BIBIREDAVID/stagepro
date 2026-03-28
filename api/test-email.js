// api/test-email.js
// Visit /api/test-email?to=your@email.com to test Resend is working
// DELETE this file after testing

export default async function handler(req, res) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    return res.status(500).json({
      error: "RESEND_API_KEY is not set",
      fix: "Add RESEND_API_KEY to Vercel environment variables and redeploy"
    });
  }

  const toEmail = req.query.to;
  if (!toEmail) {
    return res.status(400).json({
      error: "No recipient",
      fix: "Add ?to=your@email.com to the URL"
    });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "StagePro <onboarding@resend.dev>",
        to: [toEmail],
        subject: "StagePro Email Test",
        html: "<h1 style='color:#f5a623;font-family:Arial'>StagePro email is working!</h1><p>If you can read this, your Resend integration is set up correctly.</p>",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "Resend rejected the request",
        details: data,
        keyPrefix: RESEND_API_KEY.slice(0, 8) + "...",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Test email sent to ${toEmail}`,
      resendId: data.id,
    });

  } catch (err) {
    return res.status(500).json({
      error: "Network or server error",
      details: err.message,
    });
  }
}
