import crypto from "crypto";
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

function splitNameParts(value = "") {
  const clean = String(value || "").trim();
  if (!clean) return { firstName: "", lastName: "" };
  const parts = clean.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function trimObject(values = {}) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== "" && value !== undefined && value !== null)
  );
}

function buildRecipientRow(recipient = {}, fallbackBuyer = {}) {
  const recipientName = splitNameParts(recipient.name || fallbackBuyer.name || "");
  return trimObject({
    email: String(recipient.email || fallbackBuyer.email || "").trim().toLowerCase(),
    first_name: String(recipient.firstName || recipientName.firstName || "").trim(),
    last_name: String(recipient.lastName || recipientName.lastName || "").trim(),
    phone: String(recipient.phone || fallbackBuyer.phone || "").trim(),
    external_ticket_id: String(recipient.ticketId || recipient.externalTicketId || "").trim(),
    external_ticket_type: String(recipient.ticketType || recipient.externalTicketType || "").trim(),
    designation_name: String(recipient.designationName || recipient.ticketType || recipient.externalTicketType || "").trim(),
  });
}

export function normalizeHarpeninConfig(config = {}) {
  return {
    webhookUrl: normalizeHttpUrl(config.webhookUrl || ""),
    keyId: String(config.keyId || "").trim(),
    secret: String(config.secret || "").trim(),
  };
}

async function resolveHarpeninConfig({ db, organizerId, eventId }) {
  const cleanEventId = String(eventId || "").trim();
  if (cleanEventId) {
    const eventSnap = await db.collection("events").doc(cleanEventId).get();
    if (eventSnap.exists) {
      const event = eventSnap.data() || {};
      const eventConfig = normalizeHarpeninConfig(event.harpenin || {
        webhookUrl: event.harpeninWebhookUrl,
        keyId: event.harpeninKeyId,
        secret: event.harpeninSecret,
      });
      if (eventConfig.webhookUrl && eventConfig.keyId && eventConfig.secret) {
        return {
          config: eventConfig,
          event: { id: eventSnap.id, ...event },
          organizer: null,
          source: "event",
        };
      }
    }
  }

  const cleanOrganizerId = String(organizerId || "").trim();
  if (!cleanOrganizerId) {
    return { config: normalizeHarpeninConfig(), event: null, organizer: null, source: "none" };
  }

  const organizerSnap = await db.collection("users").doc(cleanOrganizerId).get();
  if (!organizerSnap.exists) {
    return { config: normalizeHarpeninConfig(), event: null, organizer: null, source: "none" };
  }

  const organizer = organizerSnap.data() || {};
  return {
    config: normalizeHarpeninConfig(organizer.harpenin || {
      webhookUrl: organizer.harpeninWebhookUrl,
      keyId: organizer.harpeninKeyId,
      secret: organizer.harpeninSecret,
    }),
    event: null,
    organizer,
    source: "organizer",
  };
}

function buildHarpeninBody({ eventType, payload = {}, resolvedEvent, organizer }) {
  const purchasedAt = String(
    payload.purchasedAt
      || payload.validation?.validatedAt
      || payload.ticket?.validatedAt
      || new Date().toISOString()
  ).trim();
  const buyerName = splitNameParts(payload.buyer?.name || "");
  const recipients = Array.isArray(payload.recipients) && payload.recipients.length > 0
    ? payload.recipients.map((recipient) => buildRecipientRow(recipient, payload.buyer || {}))
    : [buildRecipientRow({
        ...payload.recipient,
        ticketId: payload.ticket?.id,
        ticketType: payload.ticket?.type,
        designationName: payload.ticket?.designationName,
      }, payload.buyer || {})];

  return trimObject({
    external_order_id: String(payload.externalOrderId || payload.ticket?.id || "").trim(),
    purchased_at: purchasedAt,
    currency: String(payload.currency || "NGN").trim().toUpperCase(),
    total_amount: Number.isFinite(Number(payload.totalAmount)) ? Number(payload.totalAmount) : undefined,
    buyer: trimObject({
      first_name: String(payload.buyer?.firstName || buyerName.firstName || "").trim(),
      last_name: String(payload.buyer?.lastName || buyerName.lastName || "").trim(),
      email: String(payload.buyer?.email || "").trim().toLowerCase(),
      phone: String(payload.buyer?.phone || "").trim(),
    }),
    recipients: recipients.filter((row) => Object.keys(row).length > 0),
    metadata: trimObject({
      source: "stagepro",
      event_type: eventType,
      stagepro_event_id: String(payload.eventId || resolvedEvent?.id || "").trim(),
      stagepro_event_title: String(payload.eventTitle || resolvedEvent?.title || "").trim(),
      organizer_id: String(organizer?.id || payload.organizerId || "").trim(),
      validation_status: String(payload.validation ? "validated" : "").trim(),
      validated_at: String(payload.validation?.validatedAt || "").trim(),
      validated_by: String(payload.validation?.validatedBy || "").trim(),
      validated_by_id: String(payload.validation?.validatedById || "").trim(),
      payment_status: String(payload.ticket?.status || "").trim(),
    }),
  });
}

export async function sendHarpeninTicketingEvent({ organizerId, eventId, eventType, payload }) {
  if (!organizerId || !eventType || !payload) return { ok: false, skipped: "missing_input" };

  const db = getAdminDb();
  const resolved = await resolveHarpeninConfig({ db, organizerId, eventId });
  const config = resolved.config || normalizeHarpeninConfig();
  if (!config.webhookUrl || !config.keyId || !config.secret) {
    return { ok: false, skipped: "harpenin_not_configured" };
  }

  let organizer = resolved.organizer ? { id: organizerId, ...resolved.organizer } : null;
  let resolvedEvent = resolved.event || null;

  if (!resolvedEvent && eventId) {
    const eventSnap = await db.collection("events").doc(String(eventId)).get();
    if (eventSnap.exists) {
      resolvedEvent = { id: eventSnap.id, ...eventSnap.data() };
    }
  }

  if (!organizer) {
    const organizerSnap = await db.collection("users").doc(String(organizerId)).get();
    if (organizerSnap.exists) {
      organizer = { id: organizerSnap.id, ...organizerSnap.data() };
    }
  }

  const body = buildHarpeninBody({ eventType, payload, resolvedEvent, organizer });
  if (!body.external_order_id || !body.purchased_at || !Array.isArray(body.recipients) || body.recipients.length === 0) {
    return { ok: false, skipped: "invalid_payload" };
  }

  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", config.secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  try {
    const res = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-harpenin-key-id": config.keyId,
        "x-harpenin-timestamp": timestamp,
        "x-harpenin-signature": signature,
      },
      body: rawBody,
    });
    const responseBody = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      body: responseBody,
      source: resolved.source,
    };
  } catch (err) {
    console.warn("Harpenin webhook delivery failed:", err);
    return { ok: false, skipped: "request_failed" };
  }
}
