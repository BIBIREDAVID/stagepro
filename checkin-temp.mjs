import fs from "fs";

for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const { getAdminDb } = await import("./server/firebaseAdmin.js");
const db = getAdminDb();
const eventId = "YNyuxGkPncqDRkqK0Bl6";

const snap = await db
  .collection("tickets")
  .where("eventId", "==", eventId)
  .where("used", "==", false)
  .limit(1212)
  .get();

let done = 0;
for (let i = 0; i < snap.docs.length; i += 400) {
  const batch = db.batch();
  for (const d of snap.docs.slice(i, i + 400)) {
    batch.update(d.ref, { used: true });
    done++;
  }
  await batch.commit();
}

console.log(`Checked in ${done} ticket(s).`);
