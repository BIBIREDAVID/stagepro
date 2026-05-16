/**
 * One-time cleanup script: remove duplicate tickets per event/email.
 *
 * Default mode is dry-run. Nothing is deleted unless you pass --apply.
 *
 * Run:
 *   node --env-file=.env.local scripts/dedupe-tickets.js
 *   node --env-file=.env.local scripts/dedupe-tickets.js --apply
 *   node --env-file=.env.local scripts/dedupe-tickets.js --eventId=abc123 --apply
 *   node --env-file=.env.local scripts/dedupe-tickets.js --email=user@example.com --apply
 *
 * Rules:
 * - duplicates are grouped by eventId + normalized userEmail
 * - blank emails are ignored
 * - one canonical ticket is kept in each duplicate group
 * - used tickets are preferred over unused tickets
 * - otherwise, the earliest purchased ticket is kept
 * - soldCounts are rebuilt after deletions when --apply is used
 */

import { getAdminDb } from "../server/firebaseAdmin.js";

const db = getAdminDb();

function parseArgs(argv) {
  const options = {
    apply: false,
    eventId: "",
    email: "",
  };

  argv.forEach((arg) => {
    if (arg === "--apply") options.apply = true;
    else if (arg.startsWith("--eventId=")) options.eventId = arg.slice("--eventId=".length).trim();
    else if (arg.startsWith("--email=")) options.email = arg.slice("--email=".length).trim().toLowerCase();
  });

  return options;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function parseDateValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function chooseCanonicalTicket(rows) {
  const sorted = [...rows].sort((a, b) => {
    const aUsed = a.used ? 1 : 0;
    const bUsed = b.used ? 1 : 0;
    if (aUsed !== bUsed) return bUsed - aUsed;

    const aPurchased = parseDateValue(a.purchasedAt);
    const bPurchased = parseDateValue(b.purchasedAt);
    if (aPurchased !== bPurchased) return aPurchased - bPurchased;

    return String(a.id).localeCompare(String(b.id));
  });

  return sorted[0];
}

async function fetchTickets({ eventId, email }) {
  let query = db.collection("tickets");

  if (eventId) query = query.where("eventId", "==", eventId);
  if (email) query = query.where("userEmail", "==", email);

  const snap = await query.get();
  return snap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }));
}

function groupDuplicateTickets(tickets) {
  const groups = new Map();

  tickets.forEach((ticket) => {
    const eventId = String(ticket.eventId || "").trim();
    const email = normalizeEmail(ticket.userEmail);
    if (!eventId || !email) return;

    const key = `${eventId}::${email}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ticket);
  });

  return [...groups.entries()]
    .map(([key, rows]) => ({ key, rows }))
    .filter((group) => group.rows.length > 1);
}

async function rebuildSoldCountsForEventIds(eventIds) {
  for (const eventId of eventIds) {
    const snap = await db.collection("tickets").where("eventId", "==", eventId).get();
    const soldCounts = {};

    snap.docs.forEach((doc) => {
      const ticket = doc.data() || {};
      const tierId = String(ticket.tierId || "").trim();
      if (!tierId) return;
      soldCounts[tierId] = Number(soldCounts[tierId] || 0) + 1;
    });

    await db.collection("events").doc(eventId).set({
      soldCounts,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  if (options.eventId) console.log(`Filter eventId: ${options.eventId}`);
  if (options.email) console.log(`Filter email: ${options.email}`);
  console.log("Fetching tickets...");

  const tickets = await fetchTickets(options);
  console.log(`Loaded ${tickets.length} ticket(s).`);

  const duplicateGroups = groupDuplicateTickets(tickets);
  if (duplicateGroups.length === 0) {
    console.log("No duplicate event/email groups found.");
    return;
  }

  let duplicateTicketCount = 0;
  const eventIdsTouched = new Set();
  const deleteRefs = [];

  console.log(`Found ${duplicateGroups.length} duplicate group(s):\n`);

  duplicateGroups
    .sort((a, b) => b.rows.length - a.rows.length)
    .forEach((group, index) => {
      const canonical = chooseCanonicalTicket(group.rows);
      const duplicates = group.rows
        .filter((row) => row.id !== canonical.id)
        .sort((a, b) => parseDateValue(a.purchasedAt) - parseDateValue(b.purchasedAt));

      duplicateTicketCount += duplicates.length;
      eventIdsTouched.add(String(canonical.eventId || "").trim());

      const [eventId, email] = group.key.split("::");
      console.log(`${index + 1}. ${email} @ ${eventId}`);
      console.log(`   keep:   ${canonical.id} | used=${canonical.used ? "yes" : "no"} | tier=${canonical.tierName || "-"} | purchasedAt=${canonical.purchasedAt || "-"}`);

      duplicates.forEach((row) => {
        console.log(`   delete: ${row.id} | used=${row.used ? "yes" : "no"} | tier=${row.tierName || "-"} | purchasedAt=${row.purchasedAt || "-"}`);
        deleteRefs.push(row.ref);
      });
    });

  console.log(`\nSummary: ${duplicateGroups.length} duplicate group(s), ${duplicateTicketCount} duplicate ticket(s) to remove.`);

  if (!options.apply) {
    console.log("\nDry run only. Re-run with --apply to delete the duplicate tickets.");
    return;
  }

  if (deleteRefs.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  console.log("\nDeleting duplicate tickets...");
  for (let i = 0; i < deleteRefs.length; i += 400) {
    const chunk = deleteRefs.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
    console.log(`  Deleted ${Math.min(i + chunk.length, deleteRefs.length)} / ${deleteRefs.length}`);
  }

  console.log("Rebuilding soldCounts for affected events...");
  await rebuildSoldCountsForEventIds([...eventIdsTouched].filter(Boolean));

  console.log(`\nDone. Removed ${deleteRefs.length} duplicate ticket(s) across ${eventIdsTouched.size} event(s).`);
}

main().catch((err) => {
  console.error("Duplicate cleanup failed:", err);
  process.exit(1);
});
