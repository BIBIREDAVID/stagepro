import nodemailer from "nodemailer";
import { getAdminAuth, getAdminDb } from "../server/firebaseAdmin.js";
import { sendOrganizerLiveSheetLog } from "../server/liveSheet.js";
import {
  buildSquadTransferReference,
  resolveSquadBankCode,
  squadRequest,
} from "../server/squad.js";

const STAGEPRO_FEE = 100;
const SQUAD_TRANSFER_FEE_RATE = 0.012;

const hasPayoutDetails = (details = {}) =>
  Boolean(details.bankName?.trim() && details.accountName?.trim() && details.accountNumber?.trim());

function getPaymentReference(ticket = {}) {
  return String(ticket.paymentReference || ticket.reference || ticket.orderReference || "").trim();
}

function calculateTransferFee(amount = 0) {
  return Math.round(Number(amount || 0) * SQUAD_TRANSFER_FEE_RATE);
}

function calculateNet(tickets = []) {
  const paidTickets = tickets.filter(t => t.paymentStatus === "paid" && getPaymentReference(t));
  const orderRefs = [...new Set(paidTickets.map(getPaymentReference).filter(Boolean))];
  const gross = tickets.reduce((sum, t) => sum + Number(t.price || 0), 0);
  const stagePro = orderRefs.length * STAGEPRO_FEE;
  const squadTransferFee = calculateTransferFee(gross);
  return Math.max(0, Math.round(gross - stagePro - squadTransferFee));
}

async function authorize(req, db) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) return { ok: false, status: 401, msg: "Missing bearer token" };
  const token = authHeader.slice(7).trim();

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) {
    return { ok: true, kind: "cron", uid: null };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    if (!userSnap.exists || userSnap.data()?.role !== "admin") {
      return { ok: false, status: 403, msg: "Admin access required" };
    }
    return { ok: true, kind: "admin", uid: decoded.uid };
  } catch {
    return { ok: false, status: 401, msg: "Invalid bearer token" };
  }
}

async function verifyAccountName(details = {}) {
  const bankCode = resolveSquadBankCode(details.bankName, details.bankCode);
  if (!bankCode) {
    throw new Error("Could not match bank name to a Squad bank code");
  }

  const lookup = await squadRequest("/payout/account/lookup", {
    method: "POST",
    payload: {
      bank_code: bankCode,
      account_number: String(details.accountNumber || "").trim(),
    },
  });

  return {
    bankCode,
    accountName: String(lookup?.account_name || details.accountName || "").trim(),
  };
}

async function sendFailureAlert(summary) {
  const alertTo = process.env.ALERT_EMAIL_TO;
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_PASS;
  if (!alertTo || !gmailUser || !gmailPass) return;

  const failed = summary.results.filter(r => r.status === "failed");
  if (!failed.length) return;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });

  const lines = failed.map(r => `- ${r.organizerName} (${r.organizerId}): ${r.reason || "failed"}`).join("\n");
  const text = `Auto payout run ${summary.runKey}\nPaid: ${summary.paidCount}\nFailed: ${summary.failedCount}\n\nFailures:\n${lines}`;

  await transporter.sendMail({
    from: `"StagePro Alerts" <${gmailUser}>`,
    to: alertTo,
    subject: `StagePro auto payout failures (${summary.failedCount})`,
    text,
  });
}

function getRunKey(authzKind, body = {}) {
  if (body.runKey) return String(body.runKey);
  if (authzKind === "cron") {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const h = String(d.getUTCHours()).padStart(2, "0");
    return `cron-${y}${m}${day}${h}`;
  }
  return `manual-${Date.now()}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const db = getAdminDb();
  const authz = await authorize(req, db);
  if (!authz.ok) return res.status(authz.status).json({ ok: false, msg: authz.msg });

  const body = req.body || {};
  const dryRun = Boolean(body?.dryRun);
  const minAmount = Math.max(0, Number(process.env.AUTO_PAYOUT_MIN_AMOUNT || 1000));
  const holdHours = Math.max(0, Number(process.env.AUTO_PAYOUT_HOLD_HOURS || 48));
  const maxPerRun = Math.max(0, Number(process.env.AUTO_PAYOUT_MAX_PER_RUN || 500000));
  const holdCutoffMs = Date.now() - holdHours * 60 * 60 * 1000;
  const runKey = getRunKey(authz.kind, body);
  const now = new Date().toISOString();

  const runRef = db.collection("payoutRuns").doc(runKey);
  try {
    await runRef.create({
      runKey,
      status: "processing",
      createdAt: now,
      startedAt: now,
      dryRun,
      authKind: authz.kind,
      requestedBy: authz.uid || "cron",
      minAmount,
      holdHours,
      maxPerRun,
    });
  } catch (err) {
    if (err?.code === 6 || String(err?.message || "").toLowerCase().includes("already exists")) {
      return res.status(409).json({ ok: false, msg: `Run key ${runKey} already processed` });
    }
    throw err;
  }

  try {
    const organizersSnap = await db.collection("users")
      .where("role", "==", "organizer")
      .where("autoPayoutEnabled", "==", true)
      .get();

    const results = [];
    for (const organizerDoc of organizersSnap.docs) {
      const organizer = { uid: organizerDoc.id, ...organizerDoc.data() };
      const payoutDetails = organizer.payoutDetails || {};
      const item = {
        organizerId: organizer.uid,
        organizerName: organizer.name || "Organizer",
        status: "skipped",
        reason: "",
      };

      const attemptKey = `${runKey}-${organizer.uid}`;
      const attemptRef = db.collection("payoutAttempts").doc(attemptKey);
      try {
        await attemptRef.create({
          runKey,
          organizerId: organizer.uid,
          createdAt: now,
        });
      } catch (err) {
        if (err?.code === 6 || String(err?.message || "").toLowerCase().includes("already exists")) {
          item.reason = "Already attempted in this run";
          results.push(item);
          continue;
        }
        throw err;
      }

      if (!hasPayoutDetails(payoutDetails)) {
        item.reason = "Missing payout details";
        results.push(item);
        continue;
      }

      const eventsSnap = await db.collection("events").where("organizer", "==", organizer.uid).get();
      const eventIds = eventsSnap.docs.map(d => d.id);
      if (!eventIds.length) {
        item.reason = "No events";
        results.push(item);
        continue;
      }

      const ticketRows = [];
      for (let i = 0; i < eventIds.length; i += 30) {
        const chunk = eventIds.slice(i, i + 30);
        const ticketsSnap = await db.collection("tickets").where("eventId", "in", chunk).get();
        ticketsSnap.docs.forEach(d => ticketRows.push({ id: d.id, ...d.data() }));
      }

      const eligibleTickets = ticketRows.filter(t => {
        const tMs = new Date(t.purchasedAt || 0).getTime();
        return Number.isFinite(tMs) && tMs <= holdCutoffMs;
      });

      const net = calculateNet(eligibleTickets);
      const payoutsSnap = await db.collection("payouts").where("organizerId", "==", organizer.uid).get();
      const settledOrPending = payoutsSnap.docs.reduce((sum, d) => {
        const row = d.data() || {};
        if (row.status === "paid" || row.status === "processing") {
          return sum + Number(row.amount || 0);
        }
        return sum;
      }, 0);
      const outstandingRaw = Math.max(0, Math.round(net - settledOrPending));
      const outstanding = Math.min(outstandingRaw, maxPerRun || outstandingRaw);
      item.outstanding = outstandingRaw;
      item.cappedAmount = outstanding;

      if (outstanding < minAmount) {
        item.reason = `Outstanding below minimum (${minAmount})`;
        results.push(item);
        continue;
      }

      if (dryRun) {
        item.status = "dry_run_ready";
        item.amount = outstanding;
        item.transferFee = calculateTransferFee(outstanding);
        results.push(item);
        continue;
      }

      const verifiedAccount = await verifyAccountName(payoutDetails);
      const payoutRef = buildSquadTransferReference();
      const payoutDocRef = await db.collection("payouts").add({
        organizerId: organizer.uid,
        organizerName: organizer.name || "",
        amount: outstanding,
        transferFee: calculateTransferFee(outstanding),
        notes: "Automatic payout",
        status: "processing",
        createdAt: now,
        paidAt: null,
        recordedBy: authz.kind === "admin" ? authz.uid : "cron",
        source: "auto",
        runKey,
        attemptKey,
        bankSnapshot: {
          ...payoutDetails,
          bankCode: verifiedAccount.bankCode,
          accountName: verifiedAccount.accountName,
        },
        paymentProvider: "squad",
        transferReference: payoutRef,
      });

      try {
        const transfer = await squadRequest("/payout/transfer", {
          method: "POST",
          payload: {
            transaction_reference: payoutRef,
            amount: String(Math.round(outstanding * 100)),
            bank_code: verifiedAccount.bankCode,
            account_number: String(payoutDetails.accountNumber || "").trim(),
            account_name: verifiedAccount.accountName,
            currency_id: "NGN",
            remark: `StagePro automatic organizer payout ${organizer.uid}`,
          },
        });

        await db.collection("payouts").doc(payoutDocRef.id).update({
          status: "paid",
          paidAt: new Date().toISOString(),
          transferReference: transfer.transaction_reference || payoutRef,
          payoutResponse: transfer.response_description || "Success",
          nipTransactionReference: transfer.nip_transaction_reference || "",
        });

        await sendOrganizerLiveSheetLog({
          organizerId: organizer.uid,
          payload: {
            type: "payout_paid",
            title: "Organizer payout completed",
            amount: outstanding,
            transferFee: calculateTransferFee(outstanding),
            transferReference: transfer.transaction_reference || payoutRef,
            paymentProvider: "squad",
            notes: "Automatic payout",
          },
        });

        item.status = "paid";
        item.amount = outstanding;
      } catch (err) {
        await db.collection("payouts").doc(payoutDocRef.id).update({
          status: "failed",
          failureReason: String(err?.message || "Transfer failed"),
        });
        await sendOrganizerLiveSheetLog({
          organizerId: organizer.uid,
          payload: {
            type: "payout_failed",
            title: "Organizer payout failed",
            amount: outstanding,
            transferFee: calculateTransferFee(outstanding),
            transferReference: payoutRef,
            paymentProvider: "squad",
            error: String(err?.message || "Transfer failed"),
          },
        });
        item.status = "failed";
        item.reason = String(err?.message || "Transfer failed");
      }

      results.push(item);
    }

    const paidCount = results.filter(r => r.status === "paid").length;
    const failedCount = results.filter(r => r.status === "failed").length;
    const summary = {
      ok: true,
      runKey,
      ranAt: now,
      totalOrganizers: organizersSnap.size,
      paidCount,
      failedCount,
      dryRun,
      results,
    };

    await runRef.update({
      status: "completed",
      finishedAt: new Date().toISOString(),
      paidCount,
      failedCount,
      totalOrganizers: organizersSnap.size,
      results,
    });

    await sendFailureAlert(summary);
    return res.status(200).json(summary);
  } catch (err) {
    console.error("Auto payout run failed:", err);
    await runRef.update({
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: String(err?.message || "Auto payout run failed"),
    });
    return res.status(500).json({ ok: false, msg: "Auto payout run failed" });
  }
}
