import { sendHarpeninTicketingEvent } from "../server/harpenin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const { organizerId, eventId, eventType, payload } = req.body || {};
  if (!organizerId || !eventType || !payload) {
    return res.status(400).json({ ok: false, msg: "organizerId, eventType, and payload are required" });
  }

  try {
    const result = await sendHarpeninTicketingEvent({ organizerId, eventId, eventType, payload });
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("Harpenin dispatch failed:", err);
    return res.status(500).json({ ok: false, msg: "Could not dispatch Harpenin event" });
  }
}
