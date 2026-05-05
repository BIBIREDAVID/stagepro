import { Webhook } from "svix";
import { Buffer } from "node:buffer";
import { applyWebhookToTrackedEmail, isProcessedWebhookDelivery, storeWebhookEvent } from "../server/emailTracking.js";

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function getHeader(req, name) {
  const value = req.headers[name] || req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const webhookSecret = String(process.env.RESEND_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret) {
    return res.status(500).json({ ok: false, msg: "Webhook secret is not configured" });
  }

  try {
    const rawPayload = await readRawBody(req);
    const deliveryId = String(getHeader(req, "svix-id") || "").trim();
    const timestamp = String(getHeader(req, "svix-timestamp") || "").trim();
    const signature = String(getHeader(req, "svix-signature") || "").trim();

    if (!deliveryId || !timestamp || !signature) {
      return res.status(400).json({ ok: false, msg: "Missing webhook signature headers" });
    }

    const webhook = new Webhook(webhookSecret);
    const event = webhook.verify(rawPayload, {
      "svix-id": deliveryId,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    });

    if (await isProcessedWebhookDelivery(deliveryId)) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    await storeWebhookEvent({ deliveryId, event, rawPayload });
    await applyWebhookToTrackedEmail(event);

    return res.status(200).json({ ok: true, type: event?.type || "" });
  } catch (err) {
    console.error("Resend webhook error:", err);
    return res.status(400).json({ ok: false, msg: "Invalid webhook" });
  }
}
