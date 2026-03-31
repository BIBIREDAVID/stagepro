export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ ok: false, msg: "PAYSTACK_SECRET_KEY is not configured" });
  }

  const {
    reference,
    expectedAmount,
    expectedCurrency = "NGN",
    email,
  } = req.body || {};

  if (!reference) {
    return res.status(400).json({ ok: false, msg: "Missing payment reference" });
  }

  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    if (!response.ok || !data?.status || !data?.data) {
      return res.status(400).json({ ok: false, msg: data?.message || "Unable to verify transaction" });
    }

    const tx = data.data;
    if (tx.status !== "success") {
      return res.status(400).json({ ok: false, msg: `Transaction status is ${tx.status}` });
    }

    if (Number.isFinite(Number(expectedAmount)) && Number(tx.amount) !== Number(expectedAmount)) {
      return res.status(400).json({ ok: false, msg: "Verified amount does not match checkout amount" });
    }

    if (expectedCurrency && tx.currency !== expectedCurrency) {
      return res.status(400).json({ ok: false, msg: "Verified currency does not match checkout currency" });
    }

    if (email && tx.customer?.email && tx.customer.email.toLowerCase() !== String(email).toLowerCase()) {
      return res.status(400).json({ ok: false, msg: "Verified email does not match checkout email" });
    }

    return res.status(200).json({
      ok: true,
      reference: tx.reference,
      amount: tx.amount,
      currency: tx.currency,
      gatewayResponse: tx.gateway_response || "",
    });
  } catch (err) {
    console.error("Paystack verify error:", err);
    return res.status(500).json({ ok: false, msg: "Verification request failed" });
  }
}
