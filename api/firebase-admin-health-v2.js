import { getAdminDb } from "./_firebaseAdmin.js";

function has(value) {
  return !!String(value || "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, msg: "Method not allowed", version: "v2-2026-04-08" });
  }

  const envInfo = {
    hasServiceAccountJson: has(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    hasServiceAccountJsonBase64: has(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64),
    hasProjectId: has(process.env.FIREBASE_PROJECT_ID),
    hasClientEmail: has(process.env.FIREBASE_CLIENT_EMAIL),
    hasPrivateKey: has(process.env.FIREBASE_PRIVATE_KEY),
    hasPrivateKeyBase64: has(process.env.FIREBASE_PRIVATE_KEY_BASE64),
  };

  try {
    const db = getAdminDb();
    await db.collection("_healthcheck").limit(1).get();
    return res.status(200).json({
      ok: true,
      msg: "Firebase admin initialized",
      version: "v2-2026-04-08",
      envInfo,
      projectId: process.env.FIREBASE_PROJECT_ID || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      msg: "Firebase admin failed to initialize",
      version: "v2-2026-04-08",
      envInfo,
      debug: String(err?.message || "Unknown error"),
    });
  }
}
