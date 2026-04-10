import crypto from "node:crypto";

const PROD_BASE_URL = "https://api-d.squadco.com";
const SANDBOX_BASE_URL = "https://sandbox-api-d.squadco.com";

const BANK_CODE_ENTRIES = [
  ["sterling bank", "000001"],
  ["keystone bank", "000002"],
  ["fcmb", "000003"],
  ["first city monument bank", "000003"],
  ["united bank for africa", "000004"],
  ["uba", "000004"],
  ["diamond bank", "000005"],
  ["jaiz bank", "000006"],
  ["fidelity bank", "000007"],
  ["polaris bank", "000008"],
  ["skye bank", "000008"],
  ["citi bank", "000009"],
  ["citibank", "000009"],
  ["ecobank", "000010"],
  ["ecobank bank", "000010"],
  ["unity bank", "000011"],
  ["stanbicibtc bank", "000012"],
  ["stanbic ibtc bank", "000012"],
  ["gtbank", "000013"],
  ["gtbank plc", "000013"],
  ["guaranty trust bank", "000013"],
  ["guaranty trust bank plc", "000013"],
  ["access bank", "000014"],
  ["zenith bank", "000015"],
  ["zenith bank plc", "000015"],
  ["first bank", "000016"],
  ["first bank of nigeria", "000016"],
  ["wema bank", "000017"],
  ["union bank", "000018"],
  ["heritage bank", "000020"],
  ["standard chartered", "000021"],
  ["suntrust bank", "000022"],
  ["providus bank", "000023"],
  ["rand merchant bank", "000024"],
  ["rmb", "000024"],
  ["titan trust bank", "000025"],
  ["taj bank", "000026"],
  ["globus bank", "000027"],
  ["lotus bank", "000029"],
  ["premium trust bank", "000031"],
  ["optimus bank", "000036"],
  ["kuda", "090267"],
  ["kuda microfinance bank", "090267"],
  ["opay", "100004"],
  ["opal microfinance bank", "100004"],
  ["palmpay", "100033"],
  ["palmpay limited", "100033"],
  ["moniepoint", "090405"],
  ["moniepoint microfinance bank", "090405"],
  ["rubies bank", "090175"],
  ["sparkle", "090325"],
  ["sparkle microfinance bank", "090325"],
];

const BANK_CODE_MAP = new Map(BANK_CODE_ENTRIES);

export function normalizeText(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

export function getSquadSecretKey() {
  return String(process.env.SQUAD_SECRET_KEY || "").trim();
}

export function getSquadMerchantId() {
  return String(process.env.SQUAD_MERCHANT_ID || "").trim();
}

export function getSquadBaseUrl(secretKey = getSquadSecretKey()) {
  return secretKey.startsWith("sandbox_") ? SANDBOX_BASE_URL : PROD_BASE_URL;
}

export async function squadRequest(path, { method = "GET", payload, secretKey = getSquadSecretKey() } = {}) {
  if (!secretKey) throw new Error("SQUAD_SECRET_KEY is not configured");

  const res = await fetch(`${getSquadBaseUrl(secretKey)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });

  const data = await res.json().catch(() => ({}));
  const success = data?.success === true || Number(data?.status) === 200 || String(data?.message || "").toLowerCase() === "success";
  if (!res.ok || !success) {
    throw new Error(data?.message || `Squad request failed: ${path}`);
  }

  return data?.data ?? data;
}

export function buildSquadCheckoutReference(prefix = "SPRO") {
  const nonce = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now()}-${nonce}`;
}

export function buildSquadTransferReference(prefix = "SPROPO") {
  const merchantId = getSquadMerchantId();
  if (!merchantId) throw new Error("SQUAD_MERCHANT_ID is not configured");
  const nonce = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${merchantId}_${prefix}-${Date.now()}-${nonce}`;
}

export function getSquadWebhookSignature(req) {
  return String(
    req.headers["x-squad-encrypted-body"]
      || req.headers["X-Squad-Encrypted-Body"]
      || req.headers["x-squad-signature"]
      || ""
  ).trim();
}

export function verifySquadWebhook(req, secretKey = getSquadSecretKey()) {
  const signature = getSquadWebhookSignature(req);
  if (!signature || !secretKey) return false;

  const payload =
    typeof req.body === "string"
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : JSON.stringify(req.body || {});

  const expected = crypto
    .createHmac("sha512", secretKey)
    .update(payload)
    .digest("hex")
    .toUpperCase();

  try {
    return crypto.timingSafeEqual(Buffer.from(signature.toUpperCase()), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function getSquadTransactionReference(payload = {}) {
  return String(payload?.TransactionRef || payload?.transaction_ref || payload?.Body?.transaction_ref || "").trim();
}

export function getSquadTransactionBody(payload = {}) {
  return payload?.Body || payload?.data || {};
}

export function getSquadTransactionMeta(body = {}) {
  return body?.meta || body?.metadata || {};
}

export function isSquadTransactionSuccessful(body = {}) {
  return String(body?.transaction_status || "").trim().toLowerCase() === "success";
}

export function resolveSquadBankCode(bankName = "", fallbackCode = "") {
  const normalized = normalizeText(bankName);
  if (!normalized) return String(fallbackCode || "").trim();
  if (BANK_CODE_MAP.has(normalized)) return BANK_CODE_MAP.get(normalized);

  for (const [name, code] of BANK_CODE_MAP.entries()) {
    if (name.includes(normalized) || normalized.includes(name)) return code;
  }

  return String(fallbackCode || "").trim();
}
