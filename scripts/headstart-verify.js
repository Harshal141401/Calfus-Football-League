/* READ-ONLY verification (writes nothing).

   Given run-1's time, show for each existing (non-new-joiner) player:
     before   = scored points earned ON/BEFORE run 1
     after    = scored points earned AFTER run 1 (this includes the "between the two runs"
                points as well as everything since)
     HS       = current headstart in the DB
     total    = current leaderboard total (= all points + HS)
     shouldBe = total if the floor were fixed at run 1 (floored players: 13 + after)
     diff     = total - shouldBe   (0 = correct; negative = between-run points missing)

   Usage:  node scripts/headstart-verify.js "2026-07-01T11:08:00+05:30"
*/
const { connect, collections, client } = require("../src/db");
const NEW_HEADSTART = 29, FLOOR = 13;

async function main() {
  const cutoffStr = process.argv.slice(2).find(a => !a.startsWith("--"));
  const cutoff = cutoffStr ? new Date(cutoffStr) : null;
  if (!cutoff || isNaN(cutoff.getTime())) {
    console.error('Provide run-1 time, e.g.  node scripts/headstart-verify.js "2026-07-01T11:08:00+05:30"');
    process.exit(1);
  }
  console.log(`Run-1 cutoff: ${cutoff.toISOString()}\n`);
  await connect();

  const beforeAgg = await collections.predictions().aggregate([
    { $match: { scored: true, scoredAt: { $lte: cutoff } } },
    { $group: { _id: "$employeeId", pts: { $sum: "$points" } } },
  ]).toArray();
  const allAgg = await collections.predictions().aggregate([
    { $match: { scored: true } },
    { $group: { _id: "$employeeId", pts: { $sum: "$points" }, n: { $sum: 1 } } },
  ]).toArray();
  const beforeBy = new Map(beforeAgg.map(r => [String(r._id), r.pts || 0]));
  const allBy = new Map(allAgg.map(r => [String(r._id), r]));

  const emps = await collections.employees().find({}).toArray();
  const pad = (s, n) => String(s).padEnd(n);
  const rows = [];
  for (const d of emps) {
    const hs = Number(d.headstart) || 0;
    const a = allBy.get(String(d._id)) || { pts: 0, n: 0 };
    if (hs === NEW_HEADSTART) continue;          // new joiner — not floored
    if (hs === 0 && (a.n || 0) === 0) continue;  // nothing to show
    const ptsBefore = beforeBy.get(String(d._id)) || 0;
    const ptsAll = a.pts || 0;
    const ptsAfter = ptsAll - ptsBefore;
    const curTotal = ptsAll + hs;
    const expectedHs = ptsBefore < FLOOR ? FLOOR - ptsBefore : 0;
    const shouldBe = ptsAll + expectedHs;
    rows.push({ name: d.Name || d.name || d.Email || d.email || "?", ptsBefore, ptsAfter, hs, curTotal, shouldBe, diff: curTotal - shouldBe });
  }
  rows.sort((x, y) => x.diff - y.diff);
  console.log(`${pad("Name", 30)} ${pad("before", 7)} ${pad("after", 6)} ${pad("HS", 4)} ${pad("total", 6)} ${pad("shouldBe", 9)} diff`);
  rows.forEach(r => console.log(`${pad(r.name, 30)} ${pad(r.ptsBefore, 7)} ${pad(r.ptsAfter, 6)} ${pad(r.hs, 4)} ${pad(r.curTotal, 6)} ${pad(r.shouldBe, 9)} ${r.diff}`));

  const mismatched = rows.filter(r => r.diff !== 0);
  const missing = mismatched.filter(r => r.diff < 0);
  console.log(`\n${mismatched.length} player(s) don't match the run-1 floor.`);
  console.log(`${missing.length} of them are SHORT (between-run points not reflected), total ${missing.reduce((s, r) => s - r.diff, 0)} points missing.`);
  console.log(missing.length ? "→ run headstart-refloor with the same cutoff to restore them." : "→ current leaderboard already reflects all points; nothing to fix.");
  await client.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
