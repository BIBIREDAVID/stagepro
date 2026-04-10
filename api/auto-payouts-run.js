import { sendOrganizerLiveSheetLog } from "../server/liveSheet.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const { organizerId, eventId, payload } = req.body || {};
  if (!organizerId || !payload) {
    return res.status(410).json({
      ok: false,
      msg: "Automatic payouts are disabled. This endpoint is now reserved for live sheet logging only.",
    });
  }

  try {
    const result = await sendOrganizerLiveSheetLog({ organizerId, eventId, payload });
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("Live sheet logging failed:", err);
    return res.status(500).json({ ok: false, msg: "Could not log live sheet activity" });
  }
}
