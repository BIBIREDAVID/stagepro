import { buildSquadCheckoutReference, squadRequest } from "../server/squad.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "Method not allowed" });
  }

  const {
    email,
    amount,
    currency = "NGN",
    callbackUrl,
  } = req.body || {};

  if (!email || !amount || !callbackUrl) {
    return res.status(400).json({ ok: false, msg: "email, amount, and callbackUrl are required" });
  }

  try {
    const transaction_ref = buildSquadCheckoutReference();
    const data = await squadRequest("/transaction/initiate", {
      method: "POST",
      payload: {
        amount: Math.round(Number(amount) * 100),
        email: String(email).trim().toLowerCase(),
        currency,
        initiate_type: "inline",
        transaction_ref,
        callback_url: callbackUrl,
        payment_channels: ["card", "bank", "transfer"],
      },
    });

    const checkoutUrl = data?.checkout_url || data?.payment_link || data?.url || "";
    if (!checkoutUrl) {
      throw new Error("Squad did not return a checkout URL");
    }

    return res.status(200).json({
      ok: true,
      reference: transaction_ref,
      checkoutUrl,
    });
  } catch (err) {
    console.error("Initialize Squad payment failed:", err);
    return res.status(500).json({ ok: false, msg: String(err?.message || "Could not start payment") });
  }
}