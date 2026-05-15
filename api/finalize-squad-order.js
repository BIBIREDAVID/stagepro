import { getAdminDb } from "../server/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";
import { sendEmailWithFallback } from "../server/email.js";
import { sendOrganizerLiveSheetLog } from "../server/liveSheet.js";
import { buildTicketEmail } from "../server/ticketEmail.js";
import { squadRequest } from "../server/squad.js";

const SHORT_TICKET_ID_LENGTH = 7;
const SHORT_TICKET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateShortTicketId(length = SHORT_TICKET_ID_LENGTH) {
  let value = "";
  for (let i = 0; i < length; i++) {
    value += SHORT_TICKET_ALPHABET[Math.floor(Math.random() * SHORT_TICKET_ALPHABET.length)];
  }
  return value;
}

async function createUniqueTicketRef(db) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const nextId = generateShortTicketId();
    const ref = db.collection("tickets").doc(nextId);
    const snap = await ref.get();
    if (!snap.exists) return ref;
  }
  throw new Error("Could not generate a unique ticket ID");
}

async function verifySquadTransaction(reference, expectedAmount, expectedCurrency, email) {
  const tx = await squadRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (String(tx?.transaction_status || "").toLowerCase() !== "success") {
    throw new Error(`Transaction status is ${tx?.transaction_status || "unknown"}`);
  }

  if (Number.isFinite(Number(expectedAmount)) && Number(tx.transaction_amount) !== Number(expectedAmount)) {
    throw new Error("Verified amount does not match checkout amount");
  }
  if (expectedCurrency && tx.transaction_currency_id !== expectedCurrency) {
    throw new Error("Verified currency does not match checkout currency");
  }
  if (email && tx.email && String(tx.email).toLowerCase() !== String(email).toLowerCase()) {
    throw new Error("Verified email does not match checkout email");
  }

  return tx;
}

function buildRequestedQuantities(event, cart = {}) {
  const quantities = [];
  for (const tier of event.tiers || []) {
    const qty = Number(cart?.[tier.id] || 0);
    if (!Number.isInteger(qty) || qty < 0) {
      throw new Error("Cart quantities must be whole numbers");
    }
    if (qty > 0) quantities.push({ tier, qty });
  }
  if (!quantities.length) throw new Error("No tickets selected");
  return quantities;
}

async function buyerAlreadyHasTicket(db, eventId, buyerEmail) {
  if (!eventId || !buyerEmail) return false;
  const existingSnap = await db
    .collection("tickets")
    .where("eventId", "==", String(eventId))
    .where("userEmail", "==", String(buyerEmail).trim().toLowerCase())
    .limit(1)
    .get();
  return !existingSnap.empty;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const {
    reference,
    eventId,
    cart,
    buyer,
    expectedAmount,
    expectedCurrency = "NGN",
  } = req.body || {};

  const buyerEmail = String(buyer?.email || "").trim().toLowerCase();
  const buyerName = String(buyer?.name || "").trim() || "Guest";
  const buyerPhone = String(buyer?.phone || "").trim();
  const buyerUid = String(buyer?.uid || "").trim() || `guest_${Date.now()}`;
  const isGuest = !String(buyer?.uid || "").trim();

  if (!reference || !eventId || !buyerEmail) {
    return res.status(400).json({ ok: false, msg: "reference, eventId, and buyer email are required" });
  }

  try {
    const tx = await verifySquadTransaction(reference, expectedAmount, expectedCurrency, buyerEmail);
    const db = getAdminDb();

    const existingSnap = await db.collection("tickets").where("paymentReference", "==", String(reference)).get();
    const existingTickets = existingSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((ticket) => ticket.eventId === eventId && String(ticket.userEmail || "").trim().toLowerCase() === buyerEmail);

    if (existingTickets.length > 0) {
      return res.status(200).json({ ok: true, tickets: existingTickets, existing: true });
    }

    const eventRef = db.collection("events").doc(String(eventId));
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return res.status(404).json({ ok: false, msg: "Event not found" });
    }

    const event = { id: eventSnap.id, ...eventSnap.data() };
    const requested = buildRequestedQuantities(event, cart);
    const requestedTotal = requested.reduce((sum, row) => sum + row.qty, 0);

    if (requestedTotal > 1) {
      return res.status(400).json({ ok: false, msg: "Only one ticket can be purchased per buyer for this event." });
    }

    if (await buyerAlreadyHasTicket(db, event.id, buyerEmail)) {
      return res.status(409).json({ ok: false, msg: "This email has already claimed a ticket for this event." });
    }

    const soldSnap = await db.collection("tickets").where("eventId", "==", event.id).get();
    const soldCounts = {};
    soldSnap.docs.forEach((doc) => {
      const ticket = doc.data() || {};
      const tierId = String(ticket.tierId || "").trim();
      if (!tierId) return;
      soldCounts[tierId] = Number(soldCounts[tierId] || 0) + 1;
    });

    for (const { tier, qty } of requested) {
      const alreadySold = Number(soldCounts[tier.id] || 0);
      const remaining = Math.max(0, Number(tier.total || 0) - alreadySold);
      if (qty > remaining) {
        return res.status(409).json({ ok: false, msg: `Only ${remaining} ticket(s) left for ${tier.name}.` });
      }
    }

    const now = new Date().toISOString();
    const finalizationRef = db.collection("paymentFinalizations").doc(`squad_${String(reference)}`);
    const orderRef = db.collection("orders").doc(`squad_${String(reference)}`);
    const batch = db.batch();
    const newTickets = [];

    for (const { tier, qty } of requested) {
      for (let i = 0; i < qty; i++) {
        const ticketRef = await createUniqueTicketRef(db);
        const ticketData = {
          eventId: event.id,
          eventTitle: event.title,
          eventDate: event.date,
          eventTime: event.time || "",
          venue: event.venue,
          tierId: tier.id,
          tierName: tier.name,
          price: Number(tier.price),
          userId: buyerUid,
          userName: buyerName,
          userEmail: buyerEmail,
          userPhone: buyerPhone,
          isGuest,
          used: false,
          purchasedAt: now,
          paymentProvider: "squad",
          paymentReference: String(reference),
          paymentStatus: "paid",
        };
        batch.set(ticketRef, ticketData);
        newTickets.push({ id: ticketRef.id, ...ticketData });
      }
    }

    // Atomically increment soldCounts per tier — never overwrite the full map
    const soldCountIncrements = { updatedAt: now };
    for (const { tier, qty } of requested) {
      soldCountIncrements[`soldCounts.${tier.id}`] = FieldValue.increment(qty);
    }
    batch.update(eventRef, soldCountIncrements);
    batch.set(finalizationRef, {
      provider: "squad",
      reference: String(reference),
      eventId: event.id,
      buyerEmail,
      ticketIds: newTickets.map((ticket) => ticket.id),
      status: "completed",
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
    batch.set(orderRef, {
      provider: "squad",
      reference: String(reference),
      eventId: event.id,
      buyerEmail,
      totalTickets: newTickets.length,
      amount: Number(tx.transaction_amount || 0) / 100,
      currency: tx.transaction_currency_id || expectedCurrency,
      status: "completed",
      createdAt: now,
      updatedAt: now,
      ticketIds: newTickets.map((ticket) => ticket.id),
    }, { merge: true });

    await batch.commit();

    if (event.organizer) {
      await Promise.allSettled(
        newTickets.map((ticket) =>
          sendOrganizerLiveSheetLog({
            organizerId: event.organizer,
            eventId: event.id,
            payload: {
              type: "ticket_purchase",
              title: `Paid ticket purchased for ${event.title}`,
              eventId: event.id,
              eventTitle: event.title,
              ticketId: ticket.id,
              tierName: ticket.tierName,
              attendeeName: buyerName,
              attendeeEmail: buyerEmail,
              attendeePhone: buyerPhone,
              amount: ticket.price,
              currency: tx.transaction_currency_id || expectedCurrency,
              paymentReference: String(reference),
              paymentProvider: "squad",
              status: "paid",
              purchasedAt: now,
              source: "tickets_collection",
            },
          })
        )
      );
    }

    let organizerName = "StagePro";
    if (event.organizer) {
      const organizerSnap = await db.collection("users").doc(String(event.organizer)).get();
      if (organizerSnap.exists) {
        organizerName = organizerSnap.data()?.name || organizerName;
      }
    }

    const formattedDate = event.date
      ? new Date(event.date).toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
      : "See event page";
    const appBaseUrl = (process.env.PUBLIC_APP_URL || "https://stagepro-phi.vercel.app").replace(/\/+$/, "");
    const themeColors = {
      purple: "#6a11cb",
      fire: "#f83600",
      ocean: "#0575e6",
      forest: "#134e5e",
      gold: "#f7971e",
      rose: "#f953c6",
      midnight: "#232526",
      neon: "#00f260",
      sunset: "#f857a4",
      teal: "#11998e",
      royal: "#141e30",
    };
    const themeColor = themeColors[event.theme] || "#f5a623";

    await Promise.allSettled(
      newTickets.map((ticket) => {
        const message = buildTicketEmail({
          toName: buyerName,
          eventTitle: ticket.eventTitle,
          eventDate: formattedDate,
          eventTime: ticket.eventTime || "See event page",
          eventVenue: ticket.venue || "See event page",
          tierName: ticket.tierName,
          amountPaid: ticket.price === 0 ? "FREE" : `NGN ${Number(ticket.price).toLocaleString()}`,
          ticketUrl: `${appBaseUrl}/ticket/${ticket.id}`,
          ticketId: ticket.id,
          themeColor,
          organizerName,
          eventImage: event.image || "",
          socialLinks: event.socialLinks || {},
        });
        return sendEmailWithFallback({
          to: buyerEmail,
          subject: message.subject,
          html: message.html,
          fromName: "StagePro Tickets",
          kind: "ticket",
          meta: {
            ticketId: ticket.id,
            eventId: event.id,
            eventTitle: ticket.eventTitle,
            tierName: ticket.tierName,
            paymentReference: String(reference),
          },
        });
      })
    );

    return res.status(200).json({ ok: true, tickets: newTickets, existing: false });
  } catch (err) {
    console.error("Finalize Squad order failed:", err);
    return res.status(500).json({ ok: false, msg: String(err?.message || "Could not finalize order") });
  }
}
