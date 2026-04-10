import { getAdminDb } from "../server/firebaseAdmin.js";
import { sendOrganizerLiveSheetLog } from "../server/liveSheet.js";
import {
  getSquadTransactionBody,
  getSquadTransactionMeta,
  getSquadTransactionReference,
  isSquadTransactionSuccessful,
  verifySquadWebhook,
} from "../server/squad.js";

function getMetaValue(meta = {}, key) {
  if (!meta || typeof meta !== "object") return "";
  return meta[key] || meta[key?.toLowerCase?.()] || meta[key?.toUpperCase?.()] || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  if (!verifySquadWebhook(req)) {
    return res.status(401).json({ ok: false, msg: "Invalid webhook signature" });
  }

  const eventType = String(req.body?.Event || req.body?.event || "").trim();
  const reference = getSquadTransactionReference(req.body);
  const body = getSquadTransactionBody(req.body);
  const meta = getSquadTransactionMeta(body);
  const amountKobo = Number(body?.amount || body?.transaction_amount || 0);
  const transactionType = String(body?.transaction_type || body?.payment_information?.payment_type || "").trim();
  const db = getAdminDb();

  const dedupeRef = db.collection("webhookEvents").doc(`squad_${String(reference || `${eventType}-${Date.now()}`)}`);
  try {
    await dedupeRef.create({
      provider: "squad",
      eventType,
      reference,
      transactionType,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err?.code === 6 || String(err?.message || "").toLowerCase().includes("already exists")) {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    throw err;
  }

  try {
    if (eventType.toLowerCase() !== "charge_successful" || !isSquadTransactionSuccessful(body)) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    let resolvedEventId = String(getMetaValue(meta, "eventId") || getMetaValue(meta, "event_id") || "").trim();
    let organizerId = String(getMetaValue(meta, "organizerId") || getMetaValue(meta, "organizer_id") || "").trim();
    let eventTitle = String(getMetaValue(meta, "event") || "").trim() || "Event";

    if (resolvedEventId) {
      const eventSnap = await db.collection("events").doc(resolvedEventId).get();
      if (eventSnap.exists) {
        const event = eventSnap.data() || {};
        organizerId = organizerId || event.organizer || "";
        eventTitle = event.title || eventTitle;
      }
    }

    if (!resolvedEventId && reference) {
      const ticketSnap = await db.collection("tickets").where("paymentReference", "==", reference).limit(1).get();
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

    const amount = Number.isFinite(amountKobo) ? amountKobo / 100 : 0;
    const title = `Ticket payment confirmed for ${eventTitle}`;
    const customerEmail = String(body?.email || "").toLowerCase();
    const customerName = String(getMetaValue(meta, "customer") || body?.customer_name || "Attendee").trim();
    const channelType = transactionType.toLowerCase();
    const normalizedType = channelType === "transfer" ? "bank_transfer" : channelType === "card" ? "card" : channelType || "payment";

    await db.collection("organizerNotifications").add({
      organizerId,
      eventId: resolvedEventId || "",
      paymentReference: reference,
      paymentProvider: "squad",
      paymentEventType: eventType,
      amount,
      currency: body?.currency || body?.transaction_currency_id || "NGN",
      title,
      type: "ticket_sold",
      source: "squad_webhook",
      paymentMethod: normalizedType,
      read: false,
      createdAt: new Date().toISOString(),
    });

    await db.collection("organizerAttendeeFeed").add({
      organizerId,
      eventId: resolvedEventId || "",
      eventTitle,
      paymentReference: reference,
      paymentProvider: "squad",
      amount,
      currency: body?.currency || body?.transaction_currency_id || "NGN",
      attendeeName: customerName,
      attendeeEmail: customerEmail,
      attendeePhone: String(getMetaValue(meta, "phone") || "").trim(),
      status: "paid",
      source: "squad_webhook",
      paymentMethod: normalizedType,
      createdAt: new Date().toISOString(),
    });

    await sendOrganizerLiveSheetLog({
      organizerId,
      payload: {
        type: "payment_webhook",
        title: `Webhook payment confirmation for ${eventTitle}`,
        eventId: resolvedEventId || "",
        eventTitle,
        paymentReference: reference,
        paymentProvider: "squad",
        paymentMethod: normalizedType,
        amount,
        currency: body?.currency || body?.transaction_currency_id || "NGN",
        attendeeName: customerName,
        attendeeEmail: customerEmail,
      },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Squad webhook processing failed:", err);
    return res.status(500).json({ ok: false, msg: "Webhook processing failed" });
  }
}
