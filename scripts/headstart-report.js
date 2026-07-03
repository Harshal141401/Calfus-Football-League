/* READ-ONLY headstart report. Writes nothing — safe to run any time.

   Lists every employee who has a headstart or has predicted, with:
     headstart | scored prediction points | # predictions | total (= points + headstart)

   Usage:  node scripts/headstart-report.js
*/
const { connect, collections, client } = require("../src/db");

async function main() {
  await connect();
  const emps = await collections.employees().find({}).toArray();
  const agg = await collections.predictions().aggregate([
    { $match: { scored: true } },
    { $group: { _id: "$employeeId", points: { $sum: "$points" }, n: { $sum: 1 } } },
  ]).toArray();
  const by = new Map(agg.map(r => [String(r._id), r]));

  const rows = emps.map(d => {
    const a = by.get(String(d._id)) || { points: 0, n: 0 };
    const hs = Number(d.headstart) || 0;
    const name = d.Name || d.name || d.fullName || d.employeeName || d.Email || d.email || "?";
    return { name, headstart: hs, predPts: a.points || 0, preds: a.n || 0, total: (a.points || 0) + hs };
  }).filter(r => r.headstart > 0 || r.preds > 0)
    .sort((x, y) => y.total - x.total);

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad("Name", 34)} ${pad("headstart", 10)} ${pad("predPts", 9)} ${pad("#preds", 7)} total`);
  rows.forEach(r => console.log(`${pad(r.name, 34)} ${pad(r.headstart, 10)} ${pad(r.predPts, 9)} ${pad(r.preds, 7)} ${r.total}`));
  const withHs = rows.filter(r => r.headstart > 0);
  console.log(`\n${withHs.length} player(s) have a headstart (${withHs.filter(r => r.headstart === 29).length} at 29, others floored).`);

  await client.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
