// api/send-ticket-email.js
// Vercel serverless function — called after every ticket purchase
// Sends a branded confirmation email via Resend

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: "Resend API key not configured" });
  }

  const {
    toEmail, toName,
    eventTitle, eventDate, eventTime, eventVenue,
    tierName, amountPaid,
    ticketUrl, ticketId,
    eventImage, themeColor, organizerName,
  } = req.body;

  if (!toEmail || !eventTitle || !ticketUrl) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const isFree = amountPaid === "FREE" || amountPaid === "₦0";
  const accent = themeColor || "#f5a623";
  const orgName = organizerName || "StagePro";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Your StagePro Ticket</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border-radius:20px;overflow:hidden;border:1px solid #2a2a2a;">

        <!-- Event flyer image (if available) -->
        ${eventImage ? `
        <tr>
          <td style="padding:0;line-height:0;">
            <img src="${eventImage}" alt="${eventTitle}" width="600"
              style="display:block;width:100%;max-height:280px;object-fit:cover;border-radius:20px 20px 0 0;" />
          </td>
        </tr>` : ""}

        <!-- Logo header with theme colour -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a1a 0%,#111 100%);padding:28px 40px;border-bottom:2px solid ${accent};">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="font-size:26px;font-weight:900;color:${accent};letter-spacing:6px;">STAGE</span><span style="font-size:26px;font-weight:900;color:#e8e0d0;letter-spacing:6px;">PRO</span>
                  <p style="margin:4px 0 0;color:#555;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Ticket Confirmation</p>
                </td>
                <td align="right">
                  <span style="background:${isFree ? "rgba(61,220,132,0.15)" : `${accent}22`};color:${isFree ? "#3ddc84" : accent};border:1px solid ${isFree ? "rgba(61,220,132,0.4)" : `${accent}66`};padding:6px 14px;border-radius:100px;font-size:12px;font-weight:700;letter-spacing:1px;">
                    ${isFree ? "FREE EVENT" : "CONFIRMED ✓"}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:32px 40px 0;">
            <h2 style="margin:0 0 10px;color:#e8e0d0;font-size:22px;font-weight:700;">Hey ${toName || "there"},</h2>
            <p style="margin:0;color:#777;font-size:14px;line-height:1.8;">
              ${isFree
                ? `Your registration for <strong style="color:${accent};">${eventTitle}</strong> is confirmed by <strong style="color:#e8e0d0;">${orgName}</strong>. We'll see you there!`
                : `Your ticket for <strong style="color:${accent};">${eventTitle}</strong> — presented by <strong style="color:#e8e0d0;">${orgName}</strong> — is confirmed. Show the QR code at the entrance.`
              }
            </p>
          </td>
        </tr>

        <!-- Event details card -->
        <tr>
          <td style="padding:24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:14px;overflow:hidden;border:1px solid #2a2a2a;">
              <tr>
                <td style="padding:20px 24px;border-bottom:1px solid #2a2a2a;">
                  <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Event</p>
                  <p style="margin:0;font-size:20px;font-weight:800;color:#e8e0d0;">${eventTitle}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#555;">Presented by ${orgName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:16px 24px;border-right:1px solid #2a2a2a;width:33%;">
                        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Date</p>
                        <p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventDate || "See event page"}</p>
                      </td>
                      <td style="padding:16px 24px;border-right:1px solid #2a2a2a;width:33%;">
                        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Time</p>
                        <p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventTime || "TBA"}</p>
                      </td>
                      <td style="padding:16px 24px;width:33%;">
                        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Venue</p>
                        <p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventVenue || "See event page"}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 24px;border-top:1px solid #2a2a2a;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Ticket Tier</p>
                        <p style="margin:0;font-size:14px;color:#e8e0d0;font-weight:600;">${tierName || "General"}</p>
                      </td>
                      <td align="right">
                        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Amount Paid</p>
                        <p style="margin:0;font-size:20px;font-weight:800;color:${isFree ? "#3ddc84" : accent};">${amountPaid}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- QR Code with theme accent border -->
        <tr>
          <td style="padding:0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border-radius:14px;border:1px solid #2a2a2a;">
              <tr>
                <td align="center" style="padding:32px;">
                  <p style="margin:0 0 20px;font-size:10px;color:#555;letter-spacing:3px;text-transform:uppercase;">Your Entry QR Code</p>
                  <div style="display:inline-block;padding:8px;background:#0a0a0a;border-radius:12px;border:2px solid ${accent};">
                    <img
                      src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(ticketUrl)}&bgcolor=0a0a0a&color=${accent.replace("#","")}&format=png&margin=8"
                      width="220" height="220" alt="QR Code"
                      style="display:block;border-radius:8px;"
                    />
                  </div>
                  <p style="margin:16px 0 4px;font-size:11px;color:#555;">Ticket ID</p>
                  <p style="margin:0;font-size:12px;color:#777;font-family:monospace;letter-spacing:1px;">${ticketId || ""}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA button using theme colour -->
        <tr>
          <td align="center" style="padding:0 40px 32px;">
            <a href="${ticketUrl}"
              style="display:inline-block;background:${accent};color:#000000;text-decoration:none;padding:16px 48px;border-radius:12px;font-weight:800;font-size:16px;letter-spacing:2px;font-family:Arial,sans-serif;">
              VIEW MY TICKET
            </a>
            <p style="margin:14px 0 0;font-size:11px;color:#444;line-height:1.6;">
              Or open this link:<br/>
              <a href="${ticketUrl}" style="color:${accent};word-break:break-all;">${ticketUrl}</a>
            </p>
          </td>
        </tr>

        <!-- At the venue tips -->
        <tr>
          <td style="padding:0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#161616;border-radius:12px;border:1px solid #222;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 12px;font-size:11px;color:#555;letter-spacing:2px;text-transform:uppercase;">At the Venue</p>
                  <p style="margin:0 0 6px;font-size:13px;color:#777;line-height:1.7;">✦ Open this email or your ticket link on your phone</p>
                  <p style="margin:0 0 6px;font-size:13px;color:#777;line-height:1.7;">✦ Turn your screen brightness all the way up</p>
                  <p style="margin:0;font-size:13px;color:#777;line-height:1.7;">✦ Present the QR code to the scanner at the entrance</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #1e1e1e;">
            <p style="margin:0 0 8px;font-size:12px;color:#444;line-height:1.7;">
              Questions? Contact us at
              <a href="mailto:davidbibiresanmi@gmail.com" style="color:${accent};text-decoration:none;">davidbibiresanmi@gmail.com</a>
            </p>
            <p style="margin:0;font-size:11px;color:#333;">
              © 2025 StagePro · Made in Nigeria · <a href="https://stagepro-phi.vercel.app" style="color:#444;text-decoration:none;">stagepro-phi.vercel.app</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
        subject: `Your ticket for ${eventTitle} — StagePro`,
        html,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Resend error:", data);
      return res.status(500).json({ error: data.message || "Failed to send email" });
    }
    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error("Send email error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

  // Validate required fields
  if (!toEmail || !eventTitle || !ticketUrl) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const isFree = amountPaid === "FREE" || amountPaid === "₦0";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Your StagePro Ticket</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border-radius:20px;overflow:hidden;border:1px solid #2a2a2a;">

        <!-- Logo header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a1a 0%,#111 100%);padding:32px 40px;border-bottom:2px solid #f5a623;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="font-size:28px;font-weight:900;color:#f5a623;letter-spacing:6px;">STAGE</span><span style="font-size:28px;font-weight:900;color:#e8e0d0;letter-spacing:6px;">PRO</span>
                  <p style="margin:6px 0 0;color:#555;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Ticket Confirmation</p>
                </td>
                <td align="right">
                  <span style="background:${isFree ? "rgba(61,220,132,0.15)" : "rgba(245,166,35,0.15)"};color:${isFree ? "#3ddc84" : "#f5a623"};border:1px solid ${isFree ? "rgba(61,220,132,0.4)" : "rgba(245,166,35,0.4)"};padding:6px 14px;border-radius:100px;font-size:12px;font-weight:700;letter-spacing:1px;">
                    ${isFree ? "FREE EVENT" : "PAID ✓"}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:32px 40px 0;">
            <h2 style="margin:0 0 10px;color:#e8e0d0;font-size:22px;font-weight:700;">Hey ${toName || "there"} 👋</h2>
            <p style="margin:0;color:#777;font-size:14px;line-height:1.8;">
              ${isFree
                ? `Your registration for <strong style="color:#f5a623;">${eventTitle}</strong> is confirmed. We'll see you there!`
                : `Your ticket for <strong style="color:#f5a623;">${eventTitle}</strong> is confirmed and ready to use. Show the QR code below at the entrance.`
              }
            </p>
          </td>
        </tr>

        <!-- Event details card -->
        <tr>
          <td style="padding:24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:14px;overflow:hidden;border:1px solid #2a2a2a;">
              <!-- Event title -->
              <tr>
                <td style="padding:20px 24px;border-bottom:1px solid #2a2a2a;">
                  <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Event</p>
                  <p style="margin:0;font-size:20px;font-weight:800;color:#e8e0d0;">${eventTitle}</p>
                </td>
              </tr>
              <!-- Date / Time / Venue -->
              <tr>
                <td style="padding:0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:16px 24px;border-right:1px solid #2a2a2a;width:33%;">
                        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Date</p>
                        <p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventDate || "See event page"}</p>
                      </td>
                      <td style="padding:16px 24px;border-right:1px solid #2a2a2a;width:33%;">
                        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Time</p>
                        <p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventTime || "TBA"}</p>
                      </td>
                      <td style="padding:16px 24px;width:33%;">
                        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Venue</p>
                        <p style="margin:0;font-size:13px;color:#e8e0d0;font-weight:600;">${eventVenue || "See event page"}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- Tier / Amount -->
              <tr>
                <td style="padding:16px 24px;border-top:1px solid #2a2a2a;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Ticket Tier</p>
                        <p style="margin:0;font-size:14px;color:#e8e0d0;font-weight:600;">${tierName || "General"}</p>
                      </td>
                      <td align="right">
                        <p style="margin:0 0 4px;font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">Amount Paid</p>
                        <p style="margin:0;font-size:20px;font-weight:800;color:${isFree ? "#3ddc84" : "#f5a623"};">${amountPaid}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- QR Code -->
        <tr>
          <td style="padding:0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border-radius:14px;border:1px solid #2a2a2a;">
              <tr>
                <td align="center" style="padding:32px;">
                  <p style="margin:0 0 20px;font-size:10px;color:#555;letter-spacing:3px;text-transform:uppercase;">Your Entry QR Code</p>
                  <img
                    src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(ticketUrl)}&bgcolor=0a0a0a&color=f5a623&format=png&margin=10"
                    width="220"
                    height="220"
                    alt="Ticket QR Code"
                    style="display:block;border-radius:10px;margin:0 auto;"
                  />
                  <p style="margin:16px 0 4px;font-size:11px;color:#555;">Ticket ID</p>
                  <p style="margin:0;font-size:12px;color:#777;font-family:monospace;letter-spacing:1px;">${ticketId || ""}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td align="center" style="padding:0 40px 32px;">
            <a href="${ticketUrl}"
              style="display:inline-block;background:#f5a623;color:#000000;text-decoration:none;padding:16px 48px;border-radius:12px;font-weight:800;font-size:16px;letter-spacing:2px;font-family:Arial,sans-serif;">
              VIEW MY TICKET
            </a>
            <p style="margin:14px 0 0;font-size:11px;color:#444;line-height:1.6;">
              Or open this link in your browser:<br/>
              <a href="${ticketUrl}" style="color:#f5a623;word-break:break-all;">${ticketUrl}</a>
            </p>
          </td>
        </tr>

        <!-- Tips -->
        <tr>
          <td style="padding:0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#161616;border-radius:12px;border:1px solid #222;padding:0;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 12px;font-size:11px;color:#555;letter-spacing:2px;text-transform:uppercase;">At the Venue</p>
                  <p style="margin:0 0 6px;font-size:13px;color:#777;line-height:1.7;">✦ Open this email or your ticket link on your phone</p>
                  <p style="margin:0 0 6px;font-size:13px;color:#777;line-height:1.7;">✦ Turn your screen brightness all the way up</p>
                  <p style="margin:0;font-size:13px;color:#777;line-height:1.7;">✦ Present the QR code to the scanner at the entrance</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #1e1e1e;">
            <p style="margin:0 0 8px;font-size:12px;color:#444;line-height:1.7;">
              Questions? Reply to this email or contact us at
              <a href="mailto:davidbibiresanmi@gmail.com" style="color:#f5a623;text-decoration:none;">davidbibiresanmi@gmail.com</a>
            </p>
            <p style="margin:0;font-size:11px;color:#333;">
              © 2025 StagePro · Made in Nigeria 🇳🇬 · <a href="https://stagepro-phi.vercel.app" style="color:#444;text-decoration:none;">stagepro-phi.vercel.app</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "StagePro <onboarding@resend.dev>", // use this until you verify a domain
        to: [toEmail],
        subject: `Your ticket for ${eventTitle} — StagePro`,
        html,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Resend error:", data);
      return res.status(500).json({ error: data.message || "Failed to send email" });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error("Send email error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
