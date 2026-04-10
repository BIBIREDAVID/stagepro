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

export async function sendOrganizerLiveSheetLog({ organizerId, payload }) {
  const cleanOrganizerId = String(organizerId || "").trim();
  if (!cleanOrganizerId || !payload || typeof payload !== "object") return { ok: false, skipped: "missing_input" };

  const db = getAdminDb();
  const organizerSnap = await db.collection("users").doc(cleanOrganizerId).get();
  if (!organizerSnap.exists) return { ok: false, skipped: "organizer_not_found" };

  const organizer = organizerSnap.data() || {};
  const liveSheetWebhookUrl = normalizeHttpUrl(organizer.liveSheet?.webhookUrl || organizer.liveSheetWebhookUrl || "");
  if (!liveSheetWebhookUrl) return { ok: false, skipped: "webhook_not_configured" };

  const body = {
    organizerId: cleanOrganizerId,
    organizerName: organizer.name || "",
    organizerEmail: organizer.email || "",
    createdAt: new Date().toISOString(),
    ...payload,
  };

  try {
    await fetch(liveSheetWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: true };
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
