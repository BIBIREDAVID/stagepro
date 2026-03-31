import crypto from "crypto";

const DEFAULT_PROJECT_ID = "stagepro-327e8";

function verifyToken(token, secret) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!isValid) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload?.email || !payload?.exp || Date.now() > Number(payload.exp)) return null;
  return payload;
}

function parseFirestoreValue(field = {}) {
  if ("stringValue" in field) return field.stringValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("doubleValue" in field) return Number(field.doubleValue);
  if ("booleanValue" in field) return Boolean(field.booleanValue);
  if ("timestampValue" in field) return field.timestampValue;
  if ("nullValue" in field) return null;
  return "";
}

function parseTicketDocument(document) {
  const fields = document.fields || {};
  return {
    id: document.name.split("/").pop(),
    eventId: parseFirestoreValue(fields.eventId),
    eventTitle: parseFirestoreValue(fields.eventTitle),
    eventDate: parseFirestoreValue(fields.eventDate),
    eventTime: parseFirestoreValue(fields.eventTime),
    venue: parseFirestoreValue(fields.venue),
    tierName: parseFirestoreValue(fields.tierName),
    price: parseFirestoreValue(fields.price),
    userName: parseFirestoreValue(fields.userName),
    userEmail: parseFirestoreValue(fields.userEmail),
    used: parseFirestoreValue(fields.used),
    purchasedAt: parseFirestoreValue(fields.purchasedAt),
  };
}

async function fetchTicketsByEmail(email) {
  const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "tickets" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "userEmail" },
            op: "EQUAL",
            value: { stringValue: email.toLowerCase() },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error("Could not load tickets");
  }

  const rows = await response.json();
  return rows
    .filter(row => row.document)
    .map(row => parseTicketDocument(row.document))
    .sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const ACCESS_SECRET = process.env.TICKET_ACCESS_SECRET;
  if (!ACCESS_SECRET) {
    return res.status(500).json({ ok: false, msg: "Ticket access verification is not configured" });
  }

  const token = req.body?.token;
  const payload = verifyToken(token, ACCESS_SECRET);
  if (!payload) {
    return res.status(400).json({ ok: false, msg: "This access link is invalid or has expired." });
  }

  try {
    const tickets = await fetchTicketsByEmail(payload.email);
    return res.status(200).json({
      ok: true,
      email: payload.email,
      tickets,
    });
  } catch (err) {
    console.error("Ticket access verify error:", err);
    return res.status(500).json({ ok: false, msg: "Could not load tickets for this access link." });
  }
}
