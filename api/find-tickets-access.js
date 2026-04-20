import { getAdminDb } from "../server/firebaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ ok: false, msg: "A valid email address is required." });
  }

  try {
    const db = getAdminDb();
    const snap = await db
      .collection("tickets")
      .where("userEmail", "==", email)
      .get();

    const tickets = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0));

    return res.status(200).json({ ok: true, tickets });
  } catch (err) {
    console.error("Find tickets error:", err);
    return res.status(500).json({ ok: false, msg: "Could not look up tickets. Please try again." });
  }
}
