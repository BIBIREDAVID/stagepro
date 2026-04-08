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

function resolveServiceAccountFromEnv() {
  const directJson = stripWrappingQuotes(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "");
  if (directJson) {
    try {
      return JSON.parse(directJson);
    } catch {
      // try next source
    }
  }

  const b64Json = stripWrappingQuotes(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || "");
  if (b64Json) {
    try {
      const decoded = Buffer.from(b64Json, "base64").toString("utf8");
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }

  return null;
}

function getAdminApp() {
  if (getApps().length) return getApps()[0];

  const fromJson = resolveServiceAccountFromEnv();
  if (fromJson?.client_email && fromJson?.private_key) {
    return initializeApp({
      credential: cert({
        projectId: fromJson.project_id || stripWrappingQuotes(process.env.FIREBASE_PROJECT_ID || "stagepro-327e8"),
        clientEmail: fromJson.client_email,
        privateKey: String(fromJson.private_key).replace(/\\n/g, "\n"),
      }),
    });
  }

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
