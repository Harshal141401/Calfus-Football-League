/* Rebuild the one-time floor AS OF a cutoff time (i.e. your first, intended run) — this
   undoes a later re-run of the flooring script that re-snapshotted at a later moment.

   For every employee that is NOT a new joiner (new joiners have headstart 29, left as-is):
     pointsAsOf = sum of scored prediction points with scoredAt <= cutoff
     headstart  = pointsAsOf < 13 ? (13 - pointsAsOf) : 0
   This reproduces exactly what the flooring script would have written at `cutoff`.

   Usage:
     node scripts/headstart-refloor.js "2026-07-01T14:00:00+05:30" --dry-run   # preview
     node scripts/headstart-refloor.js "2026-07-01T14:00:00+05:30"             # apply
*/
const { connect, collections, client } = require("../src/db");

const NEW_HEADSTART = 29;
const FLOOR = 13;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const cutoffStr = args.find(a => !a.startsWith("--"));
  const cutoff = cutoffStr ? new Date(cutoffStr) : null;
  if (!cutoff || isNaN(cutoff.getTime())) {
    console.error('Provide the run-1 cutoff time, e.g.  node scripts/headstart-refloor.js "2026-07-01T14:00:00+05:30" --dry-run');
    process.exit(1);
  }
  console.log(`Rebuilding floor as of cutoff: ${cutoff.toISOString()}${dryRun ? "  (dry run)" : ""}`);
  await connect();

  // Each player's scored points AS OF the cutoff (predictions scored on/before it).
  const agg = await collections.predictions().aggregate([
    { $match: { scored: true, scoredAt: { $lte: cutoff } } },
    { $group: { _id: "$employeeId", points: { $sum: "$points" } } },
  ]).toArray();
  const ptsById = new Map(agg.map(r => [String(r._id), r.points || 0]));

  const emps = await collections.employees().find({}).toArray();
  let changed = 0, unchanged = 0;
  for (const d of emps) {
    if ((Number(d.headstart) || 0) === NEW_HEADSTART) continue;   // new joiner — keep 29
    const pts = ptsById.get(String(d._id)) || 0;
    const want = pts < FLOOR ? FLOOR - pts : 0;
    const cur = Number(d.headstart) || 0;
    if (want === cur) { unchanged++; continue; }
    const name = d.Name || d.name || d.fullName || d.employeeName || d.Email || d.email || "?";
    console.log(`${dryRun ? "[would set]" : "[set]"} ${name}: headstart ${cur} -> ${want}  (pts@cutoff ${pts})`);
    if (!dryRun) await collections.employees().updateOne({ _id: d._id }, { $set: { headstart: want } });
    changed++;
  }

  console.log(dryRun
    ? `\n(dry run) ${changed} player(s) would change, ${unchanged} already correct.`
    : `\nDone: ${changed} player(s) updated, ${unchanged} already correct.`);
  await client.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
