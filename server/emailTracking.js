import { getAdminDb } from "./firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";

function clean(value = "") {
  return String(value || "").trim();
}

export async function recordEmailSend({
  provider = "",
  providerMessageId = "",
  to = "",
  subject = "",
  kind = "generic",
  meta = {},
}) {
  const messageId = clean(providerMessageId);
  if (!messageId) return null;

  const db = getAdminDb();
  const now = new Date().toISOString();
  await db.collection("emailSends").doc(messageId).set({
    provider: clean(provider),
    providerMessageId: messageId,
    to: clean(to).toLowerCase(),
    subject: clean(subject),
    kind: clean(kind),
    meta: meta || {},
    status: "sent",
    createdAt: now,
    updatedAt: now,
    lastEventType: "email.sent",
    lastEventAt: now,
  }, { merge: true });
  return messageId;
}

export async function isProcessedWebhookDelivery(deliveryId = "") {
  const id = clean(deliveryId);
  if (!id) return false;
  const db = getAdminDb();
  const snap = await db.collection("emailWebhookEvents").doc(id).get();
  return snap.exists;
}

export async function storeWebhookEvent({ deliveryId = "", event = null, rawPayload = "" }) {
  const id = clean(deliveryId);
  if (!id || !event) return;
  const db = getAdminDb();
  await db.collection("emailWebhookEvents").doc(id).set({
    deliveryId: id,
    type: clean(event?.type),
    createdAt: clean(event?.created_at) || new Date().toISOString(),
    emailId: clean(event?.data?.email_id),
    payload: event,
    rawPayload: clean(rawPayload),
    storedAt: new Date().toISOString(),
  }, { merge: true });
}

export async function applyWebhookToTrackedEmail(event = {}) {
  const emailId = clean(event?.data?.email_id);
  if (!emailId) return null;

  const db = getAdminDb();
  const emailRef = db.collection("emailSends").doc(emailId);
  const emailSnap = await emailRef.get();
  const now = new Date().toISOString();
  const eventType = clean(event?.type);
  const eventAt = clean(event?.created_at) || now;
  const failureReason = clean(event?.data?.reason || event?.data?.response || event?.data?.error || "");
  const to = Array.isArray(event?.data?.to) ? clean(event.data.to[0]) : clean(event?.data?.to || "");
  const status = eventType.replace(/^email\./, "") || "updated";
  const deliveryStatus = ["bounced", "complained", "failed", "suppressed"].includes(status)
    ? "failed"
    : (["delivered", "opened", "clicked"].includes(status) ? "delivered" : status);

  await emailRef.set({
    providerMessageId: emailId,
    provider: "resend",
    to: to.toLowerCase(),
    status,
    deliveryStatus,
    updatedAt: now,
    lastEventType: eventType,
    lastEventAt: eventAt,
    lastFailureReason: failureReason || null,
    webhookData: event?.data || {},
    [`eventCounts.${status}`]: FieldValue.increment(1),
    eventTimeline: FieldValue.arrayUnion({
      type: eventType,
      status,
      at: eventAt,
      storedAt: now,
      reason: failureReason || null,
    }),
  }, { merge: true });

  if (emailSnap.exists) {
    const tracked = emailSnap.data() || {};
    const ticketId = clean(tracked?.meta?.ticketId);
    if (ticketId) {
      await db.collection("tickets").doc(ticketId).set({
        emailDelivery: {
          provider: "resend",
          providerMessageId: emailId,
          status,
          deliveryStatus,
          lastEventType: eventType,
          lastEventAt: eventAt,
          lastFailureReason: failureReason || null,
        },
      }, { merge: true });
    }
  }

  return emailId;
}
