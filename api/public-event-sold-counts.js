import { getAdminDb } from "../server/firebaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const eventIds = Array.isArray(req.body?.eventIds)
    ? req.body.eventIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  if (eventIds.length === 0) {
    return res.status(200).json({ ok: true, soldCounts: {} });
  }

  try {
    const db = getAdminDb();
    const soldCounts = {};
    const chunks = [];
    for (let i = 0; i < eventIds.length; i += 30) chunks.push(eventIds.slice(i, i + 30));

    for (const chunk of chunks) {
      const snap = await db.collection("tickets").where("eventId", "in", chunk).get();
      snap.docs.forEach((doc) => {
        const ticket = doc.data() || {};
        const eventId = String(ticket.eventId || "").trim();
        const tierId = String(ticket.tierId || "").trim();
        if (!eventId || !tierId) return;
        if (!soldCounts[eventId]) soldCounts[eventId] = {};
        soldCounts[eventId][tierId] = Number(soldCounts[eventId][tierId] || 0) + 1;
      });
    }

    return res.status(200).json({ ok: true, soldCounts });
  } catch (err) {
    console.error("Public sold-count fetch failed:", err);
    return res.status(500).json({ ok: false, msg: "Could not load sold counts" });
  }
}
