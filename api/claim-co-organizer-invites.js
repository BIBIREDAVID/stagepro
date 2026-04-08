import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "./_firebaseAdmin.js";

function readBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const [scheme, token] = String(authHeader).split(" ");
  if (scheme !== "Bearer" || !token) return "";
  return token.trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, msg: "Missing auth token" });
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const uid = String(req.body?.uid || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!uid || !email) {
      return res.status(400).json({ ok: false, msg: "uid and email are required" });
    }
    if (decoded.uid !== uid || String(decoded.email || "").toLowerCase() !== email) {
      return res.status(403).json({ ok: false, msg: "Identity mismatch" });
    }

    const db = getAdminDb();
    const snap = await db.collection("events").where("coOrganizerInviteEmails", "array-contains", email).get();
    if (snap.empty) {
      return res.status(200).json({ ok: true, updated: 0 });
    }

    const updates = snap.docs.map(doc =>
      doc.ref.update({
        coOrganizers: FieldValue.arrayUnion(uid),
        coOrganizerEmails: FieldValue.arrayUnion(email),
        coOrganizerInviteEmails: FieldValue.arrayRemove(email),
      })
    );
    await Promise.all(updates);

    return res.status(200).json({ ok: true, updated: snap.size });
  } catch (err) {
    console.error("Claim co-organizer invites failed:", err);
    return res.status(500).json({ ok: false, msg: "Could not claim co-organizer invites" });
  }
}

