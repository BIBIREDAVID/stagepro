import { getAdminAuth, getAdminDb } from "./_firebaseAdmin.js";

const MAX_TICKETS_PER_EVENT_PER_ACCOUNT = 5;

async function tryVerifyUser(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    return await getAdminAuth().verifyIdToken(token);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const { eventId, requestedQty = 0, email = "", userUid = "" } = req.body || {};
  if (!eventId) {
    return res.status(400).json({ ok: false, msg: "Missing eventId" });
  }

  const decoded = await tryVerifyUser(req);
  const verifiedUid = decoded?.uid || "";
  const normalizedEmail = String(email || "").trim().toLowerCase();

  // Use verified uid when available; otherwise fallback to email for guest flow.
  const lookupUid = verifiedUid && (!userUid || userUid === verifiedUid) ? verifiedUid : "";
  if (!lookupUid && !normalizedEmail) {
    return res.status(400).json({ ok: false, msg: "Missing user identity" });
  }

  try {
    const db = getAdminDb();
    let ticketDocs = [];
    if (lookupUid) {
      const snap = await db.collection("tickets").where("userId", "==", lookupUid).get();
      ticketDocs = snap.docs.map(d => d.data());
    } else {
      const snap = await db.collection("tickets").where("userEmail", "==", normalizedEmail).get();
      ticketDocs = snap.docs.map(d => d.data());
    }

    const existingCount = ticketDocs.filter(t => t.eventId === eventId).length;
    const qty = Math.max(0, Number(requestedQty) || 0);
    const remaining = Math.max(0, MAX_TICKETS_PER_EVENT_PER_ACCOUNT - existingCount);
    const canProceed = existingCount + qty <= MAX_TICKETS_PER_EVENT_PER_ACCOUNT;

    return res.status(200).json({
      ok: true,
      existingCount,
      remaining,
      max: MAX_TICKETS_PER_EVENT_PER_ACCOUNT,
      canProceed,
    });
  } catch (err) {
    console.error("Ticket limit check failed:", err);
    return res.status(500).json({ ok: false, msg: "Ticket limit check failed" });
  }
}
