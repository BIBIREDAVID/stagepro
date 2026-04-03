import crypto from "crypto";
import { getAdminDb } from "./_firebaseAdmin.js";

function verifyToken(token, secret) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!isValid) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload?.email || !payload?.exp || Date.now() > Number(payload.exp)) return null;
  return payload;
}

async function fetchTicketsByEmail(email) {
  const db = getAdminDb();
  const snap = await db.collection("tickets").where("userEmail", "==", email.toLowerCase()).get();
  return snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const ACCESS_SECRET = process.env.TICKET_ACCESS_SECRET;
  if (!ACCESS_SECRET) {
    return res.status(500).json({ ok: false, msg: "Ticket access verification is not configured" });
  }

  const token = req.body?.token;
  const payload = verifyToken(token, ACCESS_SECRET);
  if (!payload) {
    return res.status(400).json({ ok: false, msg: "This access link is invalid or has expired." });
  }

  try {
    const tickets = await fetchTicketsByEmail(payload.email);
    return res.status(200).json({
      ok: true,
      email: payload.email,
      tickets,
    });
  } catch (err) {
    console.error("Ticket access verify error:", err);
    return res.status(500).json({ ok: false, msg: "Could not load tickets for this access link." });
  }
}
