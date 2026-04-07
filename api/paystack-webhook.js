import crypto from "node:crypto";
import { getAdminDb } from "./_firebaseAdmin.js";

function getCustomField(metadata, variableName) {
  const fields = Array.isArray(metadata?.custom_fields) ? metadata.custom_fields : [];
  const match = fields.find((f) => String(f?.variable_name || "").toLowerCase() === variableName.toLowerCase());
  return match?.value || "";
}

function getEventIdFromPayload(data) {
  const metadata = data?.metadata || {};
  return (
    metadata.eventId ||
    metadata.event_id ||
    getCustomField(metadata, "event_id") ||
    ""
  );
}

function getOrganizerIdFromPayload(data) {
  const metadata = data?.metadata || {};
  return (
    metadata.organizerId ||
    metadata.organizer_id ||
    getCustomField(metadata, "organizer_id") ||
    ""
  );
}

function getCustomerName(data) {
  const fromMetadata = getCustomField(data?.metadata || {}, "customer");
  if (fromMetadata) return fromMetadata;
  const first = String(data?.customer?.first_name || "").trim();
  const last = String(data?.customer?.last_name || "").trim();
  const joined = `${first} ${last}`.trim();
  return joined || "Attendee";
}

function verifySignature(req, webhookSecret) {
  const signature = String(req.headers["x-paystack-signature"] || "");
  if (!signature) return false;

  const payload =
    typeof req.body === "string"
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : JSON.stringify(req.body || {});

  const expected = crypto
    .createHmac("sha512", webhookSecret)
    .update(payload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
  if (!webhookSecret) {
    return res.status(500).json({ ok: false, msg: "Webhook secret is not configured" });
  }

  if (!verifySignature(req, webhookSecret)) {
    return res.status(401).json({ ok: false, msg: "Invalid webhook signature" });
  }

  const eventType = req.body?.event || "";
  const data = req.body?.data || {};
  const reference = data?.reference || "";
  const amountKobo = Number(data?.amount || 0);
  const eventId = getEventIdFromPayload(data);

  // Handle only organizer-relevant money events.
  if (!["charge.success", "charge.failed", "refund.processed"].includes(eventType)) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  const db = getAdminDb();
  const dedupeKey = String(data?.id || reference || `${eventType}-${Date.now()}`);
  const dedupeRef = db.collection("webhookEvents").doc(`paystack_${dedupeKey}`);

  try {
    await dedupeRef.create({
      provider: "paystack",
      eventType,
      reference,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // Already processed by a previous retry.
    if (err?.code === 6 || String(err?.message || "").toLowerCase().includes("already exists")) {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    throw err;
  }

  try {
    let resolvedEventId = eventId;
    let organizerId = getOrganizerIdFromPayload(data);
    let eventTitle = getCustomField(data?.metadata || {}, "event") || "Event";

    if (resolvedEventId) {
      const eventSnap = await db.collection("events").doc(resolvedEventId).get();
      if (eventSnap.exists) {
        const ev = eventSnap.data() || {};
        organizerId = organizerId || ev.organizer || "";
        eventTitle = ev.title || eventTitle;
      }
    }

    if (!resolvedEventId && reference) {
      const ticketSnap = await db
        .collection("tickets")
        .where("paystackRef", "==", reference)
        .limit(1)
        .get();
      if (!ticketSnap.empty) {
        const ticket = ticketSnap.docs[0].data() || {};
        resolvedEventId = ticket.eventId || "";
        eventTitle = ticket.eventTitle || eventTitle;
      }
    }

    if (!organizerId && resolvedEventId) {
      const eventSnap = await db.collection("events").doc(resolvedEventId).get();
      if (eventSnap.exists) organizerId = eventSnap.data()?.organizer || "";
    }

    if (!organizerId) {
      return res.status(200).json({ ok: true, skipped: "organizer_not_resolved" });
    }

    const titleByType = {
      "charge.success": `Ticket payment confirmed for ${eventTitle}`,
      "charge.failed": `Ticket payment failed for ${eventTitle}`,
      "refund.processed": `Refund processed for ${eventTitle}`,
    };

    await db.collection("organizerNotifications").add({
      organizerId,
      eventId: resolvedEventId || "",
      paystackReference: reference,
      paystackEventType: eventType,
      amount: Number.isFinite(amountKobo) ? amountKobo / 100 : 0,
      currency: data?.currency || "NGN",
      title: titleByType[eventType] || "Payment activity update",
      type:
        eventType === "charge.success"
          ? "ticket_sold"
          : eventType === "charge.failed"
            ? "charge_failed"
            : "refund",
      source: "paystack_webhook",
      read: false,
      createdAt: new Date().toISOString(),
    });

    if (eventType === "charge.success" || eventType === "charge.failed") {
      const customerEmail = String(data?.customer?.email || "").toLowerCase();
      const customerName = getCustomerName(data);
      await db.collection("organizerAttendeeFeed").add({
        organizerId,
        eventId: resolvedEventId || "",
        eventTitle,
        paystackReference: reference,
        amount: Number.isFinite(amountKobo) ? amountKobo / 100 : 0,
        currency: data?.currency || "NGN",
        attendeeName: customerName,
        attendeeEmail: customerEmail,
        status: eventType === "charge.success" ? "paid" : "failed",
        source: "paystack_webhook",
        createdAt: new Date().toISOString(),
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Paystack webhook processing failed:", err);
    return res.status(500).json({ ok: false, msg: "Webhook processing failed" });
  }
}
