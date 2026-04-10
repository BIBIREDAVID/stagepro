import { getAdminDb } from "./firebaseAdmin.js";

function normalizeHttpUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

async function resolveLiveSheetWebhook({ db, organizerId, eventId }) {
  const cleanEventId = String(eventId || "").trim();
  if (cleanEventId) {
    const eventSnap = await db.collection("events").doc(cleanEventId).get();
    if (eventSnap.exists) {
      const event = eventSnap.data() || {};
      const eventWebhook = normalizeHttpUrl(event.liveSheet?.webhookUrl || event.liveSheetWebhookUrl || "");
      if (eventWebhook) {
        return {
          webhookUrl: eventWebhook,
          event: { id: eventSnap.id, ...event },
          source: "event",
        };
      }
    }
  }

  const cleanOrganizerId = String(organizerId || "").trim();
  if (!cleanOrganizerId) return { webhookUrl: "", event: null, source: "none", organizer: null };

  const organizerSnap = await db.collection("users").doc(cleanOrganizerId).get();
  if (!organizerSnap.exists) return { webhookUrl: "", event: null, source: "none", organizer: null };

  const organizer = organizerSnap.data() || {};
  return {
    webhookUrl: normalizeHttpUrl(organizer.liveSheet?.webhookUrl || organizer.liveSheetWebhookUrl || ""),
    event: null,
    source: "organizer",
    organizer,
  };
}

export async function sendOrganizerLiveSheetLog({ organizerId, eventId, payload }) {
  const cleanOrganizerId = String(organizerId || "").trim();
  if (!cleanOrganizerId || !payload || typeof payload !== "object") return { ok: false, skipped: "missing_input" };

  const db = getAdminDb();
  const resolved = await resolveLiveSheetWebhook({ db, organizerId: cleanOrganizerId, eventId });
  const organizer = resolved.organizer || null;
  const liveSheetWebhookUrl = resolved.webhookUrl;
  if (!liveSheetWebhookUrl) return { ok: false, skipped: "webhook_not_configured" };

  const body = {
    organizerId: cleanOrganizerId,
    organizerName: organizer?.name || "",
    organizerEmail: organizer?.email || "",
    eventId: String(eventId || payload.eventId || "").trim(),
    createdAt: new Date().toISOString(),
    ...payload,
  };

  try {
    await fetch(liveSheetWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: true, source: resolved.source };
  } catch (err) {
    console.warn("Organizer live sheet log failed:", err);
    return { ok: false, skipped: "request_failed" };
  }
}

export function normalizeLiveSheetConfig(config = {}) {
  return {
    webhookUrl: normalizeHttpUrl(config.webhookUrl || ""),
    viewUrl: normalizeHttpUrl(config.viewUrl || ""),
    updatedAt: new Date().toISOString(),
  };
}
