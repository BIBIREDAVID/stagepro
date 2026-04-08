import { getAdminDb } from "./_firebaseAdmin.js";

function bool(v) {
  return !!String(v || "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const envInfo = {
    hasServiceAccountJson: bool(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    hasServiceAccountJsonBase64: bool(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64),
    hasProjectId: bool(process.env.FIREBASE_PROJECT_ID),
    hasClientEmail: bool(process.env.FIREBASE_CLIENT_EMAIL),
    hasPrivateKey: bool(process.env.FIREBASE_PRIVATE_KEY),
    hasPrivateKeyBase64: bool(process.env.FIREBASE_PRIVATE_KEY_BASE64),
  };

  try {
    const db = getAdminDb();
    // Lightweight no-op read to confirm admin credentials really initialize
    await db.collection("_healthcheck").limit(1).get();
    return res.status(200).json({
      ok: true,
      msg: "Firebase admin initialized",
      envInfo,
      projectId: process.env.FIREBASE_PROJECT_ID || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      msg: "Firebase admin failed to initialize",
      envInfo,
      debug: String(err?.message || "Unknown error"),
    });
  }
}
