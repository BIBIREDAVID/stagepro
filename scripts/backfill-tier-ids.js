import { getAdminAuth, getAdminDb } from "../server/firebaseAdmin.js";

async function authorizeAdmin(req, db) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, msg: "Missing bearer token" };
  }

  const token = authHeader.slice(7).trim();

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const userSnap = await db.collection("users").doc(decoded.uid).get();

    if (!userSnap.exists || userSnap.data()?.role !== "admin") {
      return { ok: false, status: 403, msg: "Admin access required" };
    }

    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, status: 401, msg: "Invalid bearer token" };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const db = getAdminDb();
  const authz = await authorizeAdmin(req, db);
  if (!authz.ok) {
    return res.status(authz.status).json({ ok: false, msg: authz.msg });
  }

  try {
    const [eventsSnap, ticketsSnap] = await Promise.all([
      db.collection("events").get(),
      db.collection("tickets").get(),
    ]);

    const eventTierMap = new Map();
    eventsSnap.docs.forEach((docSnap) => {
      const event = docSnap.data() || {};
      const byName = new Map();
      (event.tiers || []).forEach((tier) => {
        if (tier?.name) {
          byName.set(String(tier.name).trim().toLowerCase(), tier.id);
        }
      });
      eventTierMap.set(docSnap.id, byName);
    });

    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let batch = db.batch();
    let batchCount = 0;
    const flushes = [];

    for (const ticketDoc of ticketsSnap.docs) {
      scanned++;
      const ticket = ticketDoc.data() || {};

      if (ticket.tierId || !ticket.eventId || !ticket.tierName) {
        skipped++;
        continue;
      }

      const tiersByName = eventTierMap.get(ticket.eventId);
      const matchedTierId = tiersByName?.get(String(ticket.tierName).trim().toLowerCase());

      if (!matchedTierId) {
        skipped++;
        continue;
      }

      batch.update(ticketDoc.ref, { tierId: matchedTierId });
      batchCount++;
      updated++;

      if (batchCount >= 400) {
        flushes.push(batch.commit());
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      flushes.push(batch.commit());
    }

    await Promise.all(flushes);

    return res.status(200).json({ ok: true, scanned, updated, skipped });
  } catch (err) {
    console.error("Tier ID backfill failed:", err);
    return res.status(500).json({ ok: false, msg: "Tier ID backfill failed" });
  }
}
