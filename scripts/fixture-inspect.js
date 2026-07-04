/* READ-ONLY: dump knockout fixtures with their stored kickoff (UTC + IST), status, live
   flags, and whether they're currently locked/kicked off per the server clock. Writes nothing.

   Usage:  node scripts/fixture-inspect.js
*/
const { connect, collections, client } = require("../src/db");
const { DateTime } = require("luxon");
const cfg = require("../src/config");

async function main() {
  await connect();
  const now = DateTime.now();
  console.log(`Server now (UTC): ${now.toUTC().toISO()}`);
  console.log(`Server now (IST): ${now.setZone("Asia/Kolkata").toFormat("ccc dd LLL yyyy, hh:mm a")}`);
  console.log(`FIXTURE_TZ = ${cfg.FIXTURE_TZ} | LOCK_BEFORE_MIN = ${cfg.LOCK_BEFORE_MIN}\n`);

  const teams = await collections.teams().find({}).toArray();
  const tById = new Map(teams.map(t => [String(t.id), t]));
  const ab = id => id ? ((tById.get(String(id)) || {}).abbr || "?") : "—";

  const isKO = r => { r = String(r || "").toLowerCase();
    return r.includes("round of 16") || r.includes("round of 32") || r.includes("quarter") || r.includes("semi") || r.includes("final") || r.includes("third"); };

  const fx = (await collections.fixtures().find({}).toArray())
    .filter(f => isKO(f.round))
    .sort((a, b) => Number(a.apiId) - Number(b.apiId));

  for (const f of fx) {
    const k = f.kickoff ? DateTime.fromISO(f.kickoff) : null;
    const ist = k ? k.setZone("Asia/Kolkata").toFormat("dd LLL, hh:mm a") : "—";
    const locked = k ? (now >= k.minus({ minutes: cfg.LOCK_BEFORE_MIN })) : false;
    const kicked = k ? (now >= k) : false;
    console.log(`M${f.apiId}  ${ab(f.teamAId)} v ${ab(f.teamBId)}  | ${f.round}`);
    console.log(`     date=${f.date} time=${f.time}  kickoff=${f.kickoff}  (IST ${ist})`);
    console.log(`     status=${f.status || "scheduled"} result=${f.result || "-"} live=${f.liveStatus || "-"}  LOCKED=${locked} KICKED_OFF=${kicked}`);
  }
  await client.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
