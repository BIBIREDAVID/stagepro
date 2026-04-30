/**
 * Bulk check-in all tickets for an event.
 * Run with: node --env-file=.env.local scripts/bulk-checkin.js
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function stripQuotes(v) {
  const r = String(v || "").trim();
  return (r.startsWith('"') && r.endsWith('"')) || (r.startsWith("'") && r.endsWith("'")) ? r.slice(1,-1) : r;
}

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const directJson = stripQuotes(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "");
  if (directJson) {
    try { return initializeApp({ credential: cert(JSON.parse(directJson)) }); } catch {}
  }
  const b64 = stripQuotes(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || "");
  if (b64) {
    try { return initializeApp({ credential: cert(JSON.parse(Buffer.from(b64, "base64").toString("utf8"))) }); } catch {}
  }
  return initializeApp({ credential: cert({
    projectId: stripQuotes(process.env.FIREBASE_PROJECT_ID || "stagepro-327e8"),
    clientEmail: stripQuotes(process.env.FIREBASE_CLIENT_EMAIL || ""),
    privateKey: stripQuotes(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  })});
}

const db = getFirestore(getAdminApp());

async function bulkCheckin() {
  console.log("Fetching all tickets...");
  const snap = await db.collection("tickets").where("used", "==", false).get();

  if (snap.empty) { console.log("No unchecked tickets found."); return; }

  console.log(`Found ${snap.size} unchecked tickets. Checking in...`);

  // Firestore batch limit is 500 — split into chunks
  const chunks = [];
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 500) chunks.push(docs.slice(i, i + 500));

  let total = 0;
  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach(d => batch.update(d.ref, { used: true }));
    await batch.commit();
    total += chunk.length;
    console.log(`  ✓ ${total} / ${snap.size} checked in...`);
  }

  console.log(`\n✅ Done. ${total} tickets marked as checked in.`);
}

bulkCheckin().catch(err => { console.error("❌ Error:", err.message); process.exit(1); });
