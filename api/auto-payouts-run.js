export default async function handler(req, res) {
  return res.status(410).json({
    ok: false,
    msg: "Automatic payouts are disabled. StagePro is now using manual payouts only.",
  });
}
