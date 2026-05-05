import { getAdminDb } from "../server/firebaseAdmin.js";
import { Buffer } from "node:buffer";

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeEventIds(value) {
  const rows = Array.isArray(value) ? value : String(value || "").split(",");
  return rows.map((id) => String(id || "").trim()).filter(Boolean);
}

function normalizeTierName(value = "") {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const body = req.method === "POST" ? await readJsonBody(req) : {};
  const eventIds = normalizeEventIds(body?.eventIds || req.query?.eventIds || req.query?.eventId);

  if (eventIds.length === 0) {
    return res.status(200).json({ ok: true, soldCounts: {} });
  }

  try {
    const db = getAdminDb();
    const soldCounts = {};
    const eventDocs = await Promise.all(
      eventIds.map((eventId) => db.collection("events").doc(eventId).get())
    );
    const eventTierLookup = {};
    const storedEventCounts = {};

    eventDocs.forEach((eventDoc) => {
      if (!eventDoc.exists) return;
      const event = eventDoc.data() || {};
      const tiers = Array.isArray(event.tiers) ? event.tiers : [];
      eventTierLookup[eventDoc.id] = tiers.reduce((acc, tier) => {
        const id = String(tier?.id || "").trim();
        const name = normalizeTierName(tier?.name);
        if (id && name) acc[name] = id;
        return acc;
      }, {});
      if (tiers.length === 1 && tiers[0]?.id) {
        eventTierLookup[eventDoc.id].__singleTierId = String(tiers[0].id).trim();
      }
      if (event.soldCounts && typeof event.soldCounts === "object") {
        storedEventCounts[eventDoc.id] = event.soldCounts;
      }
    });

    const chunks = [];
    for (let i = 0; i < eventIds.length; i += 30) chunks.push(eventIds.slice(i, i + 30));

    for (const chunk of chunks) {
      const snap = await db.collection("tickets").where("eventId", "in", chunk).get();
      snap.docs.forEach((doc) => {
        const ticket = doc.data() || {};
        const eventId = String(ticket.eventId || "").trim();
        const tierId = String(ticket.tierId || "").trim()
          || eventTierLookup[eventId]?.[normalizeTierName(ticket.tierName)]
          || eventTierLookup[eventId]?.__singleTierId;
        if (!eventId || !tierId) return;
        if (!soldCounts[eventId]) soldCounts[eventId] = {};
        soldCounts[eventId][tierId] = Number(soldCounts[eventId][tierId] || 0) + 1;
      });
    }

    const missingEventIds = eventIds.filter((eventId) => !soldCounts[eventId]);
    missingEventIds.forEach((eventId) => {
      if (storedEventCounts[eventId]) soldCounts[eventId] = storedEventCounts[eventId];
    });

    return res.status(200).json({ ok: true, soldCounts });
  } catch (err) {
    console.error("Public sold-count fetch failed:", err);
    return res.status(500).json({ ok: false, msg: "Could not load sold counts" });
  }
}
