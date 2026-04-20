/**
 * One-time script: rebuilds soldCounts on every event doc
 * from the actual tickets collection.
 *
 * Run with:
 *   node --env-file=.env.local scripts/backfill-sold-counts.js
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function stripQuotes(value) {
  const raw = String(value || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function getAdminApp() {
  if (getApps().length) return getApps()[0];

  // Try FIREBASE_SERVICE_ACCOUNT_JSON first
  const directJson = stripQuotes(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "");
  if (directJson) {
    try {
      const sa = JSON.parse(directJson);
      return initializeApp({ credential: cert(sa) });
    } catch {}
  }

  // Try base64 encoded
  const b64 = stripQuotes(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || "");
  if (b64) {
    try {
      const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      return initializeApp({ credential: cert(sa) });
    } catch {}
  }

  // Try individual env vars
  const projectId = stripQuotes(process.env.FIREBASE_PROJECT_ID || "stagepro-327e8");
  const clientEmail = stripQuotes(process.env.FIREBASE_CLIENT_EMAIL || "");
  const privateKeyRaw = stripQuotes(process.env.FIREBASE_PRIVATE_KEY || "");
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    console.error("❌ Could not find Firebase credentials in .env.local");
    console.error("Make sure one of these is set:");
    console.error("  FIREBASE_SERVICE_ACCOUNT_JSON");
    console.error("  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64");
    console.error("  FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY");
    process.exit(1);
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

const db = getFirestore(getAdminApp());

async function backfill() {
  console.log("Fetching all tickets...");
  const ticketsSnap = await db.collection("tickets").get();

  const counts = {};
  ticketsSnap.docs.forEach(doc => {
    const { eventId, tierId } = doc.data();
    if (!eventId || !tierId) return;
    if (!counts[eventId]) counts[eventId] = {};
    counts[eventId][tierId] = (counts[eventId][tierId] || 0) + 1;
  });

  const eventIds = Object.keys(counts);
  console.log(`Found tickets across ${eventIds.length} event(s). Writing soldCounts...`);

  for (const [eventId, soldCounts] of Object.entries(counts)) {
    await db.collection("events").doc(eventId).update({
      soldCounts,
      updatedAt: new Date().toISOString(),
    });
    console.log(`✓ ${eventId}`, soldCounts);
  }

  console.log("\n✅ Done. soldCounts are now accurate on all event docs.");
}

backfill().catch(err => { console.error("❌ Error:", err.message); process.exit(1); });