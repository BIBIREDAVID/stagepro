import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function stripWrappingQuotes(value) {
  const raw = String(value || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function resolvePrivateKey() {
  const b64 = stripWrappingQuotes(process.env.FIREBASE_PRIVATE_KEY_BASE64 || "");
  if (b64) {
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      if (decoded.includes("BEGIN PRIVATE KEY")) return decoded;
    } catch {
      // fall through to direct key parsing
    }
  }

  const direct = stripWrappingQuotes(process.env.FIREBASE_PRIVATE_KEY || "");
  if (!direct) return "";
  return direct.replace(/\\n/g, "\n");
}

function getAdminApp() {
  if (getApps().length) return getApps()[0];

  const projectId = stripWrappingQuotes(process.env.FIREBASE_PROJECT_ID || "stagepro-327e8");
  const clientEmail = stripWrappingQuotes(process.env.FIREBASE_CLIENT_EMAIL || "");
  const privateKey = resolvePrivateKey();

  if (!clientEmail || !privateKey) {
    throw new Error("Firebase admin credentials are not configured");
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}
