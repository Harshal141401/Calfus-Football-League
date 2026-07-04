/* Correct the Round of 16 kickoff times (IST), matched by team pairing rather than match
   number. For each pairing it finds the R16 fixture with those two teams and sets its
   date / time / kickoff. Idempotent; re-run after any re-seed that reverts the times.

   Usage:
     node scripts/fix-r16-times.js --dry-run   # preview, writes nothing
     node scripts/fix-r16-times.js             # apply
*/
const { connect, collections, client } = require("../src/db");
const { DateTime } = require("luxon");
const cfg = require("../src/config");

// [ [teamA aliases], [teamB aliases], "YYYY-MM-DD", "HH:MM" ]  — all IST
const FIXES = [
  [["Canada"],                 ["Morocco"], "2026-07-04", "22:30"],
  [["Paraguay"],               ["France"],  "2026-07-05", "02:30"],
  [["Brazil"],                 ["Norway"],  "2026-07-06", "01:30"],
  [["Mexico"],                 ["England"], "2026-07-06", "05:30"],
  [["Portugal"],               ["Spain"],   "2026-07-07", "00:30"],
  [["USA", "United States"],   ["Belgium"], "2026-07-07", "05:30"],
  [["Argentina"],              ["Egypt"],   "2026-07-07", "21:30"],
  [["Switzerland"],            ["Colombia"],"2026-07-08", "01:30"],
];

const norm = s => String(s || "").trim().toLowerCase();
const teamIs = (team, aliases) => aliases.some(a => norm(team.name) === norm(a) || norm(team.abbr) === norm(a));

async function main() {
  const dry = process.argv.includes("--dry-run");
  await connect();
  const teams = await collections.teams().find({}).toArray();
  const tById = new Map(teams.map(t => [String(t.id), t]));
  const r16 = (await collections.fixtures().find({}).toArray())
    .filter(f => String(f.round || "").toLowerCase().includes("round of 16"));

  let done = 0, miss = 0;
  for (const [aA, aB, date, time] of FIXES) {
    const hit = r16.find(f => {
      const a = tById.get(String(f.teamAId)) || {}, b = tById.get(String(f.teamBId)) || {};
      return (teamIs(a, aA) && teamIs(b, aB)) || (teamIs(a, aB) && teamIs(b, aA));
    });
    if (!hit) { console.log(`[MISS] ${aA[0]} vs ${aB[0]} — no R16 fixture with both teams (teams may not be advanced yet)`); miss++; continue; }
    const ist = DateTime.fromISO(`${date}T${time}`, { zone: cfg.FIXTURE_TZ });
    const kickoff = ist.toUTC().toISO();
    const a = tById.get(String(hit.teamAId)) || {}, b = tById.get(String(hit.teamBId)) || {};
    console.log(`${dry ? "[would fix]" : "[fix]"} M${hit.apiId}  ${a.abbr} v ${b.abbr}:  ${hit.date} ${hit.time}  ->  ${date} ${time}  (kickoff ${kickoff})`);
    if (!dry) await collections.fixtures().updateOne({ _id: hit._id }, { $set: { date, time, kickoff } });
    done++;
  }
  console.log(`\n${done} fixture(s) ${dry ? "would be" : ""} updated, ${miss} not found.${dry ? "  (dry run — nothing written)" : ""}`);
  await client.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
