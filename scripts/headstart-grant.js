/* One-time headstart grant.

   • Adds the new joiners to the employees collection with a 29-point headstart.
   • Floors every OTHER employee to 13: headstart = max(0, 13 - current points) so anyone
     below 13 (including those who never predicted) starts at 13; players already ≥13 are
     left unchanged (headstart 0).

   The headstart is a permanent base — prediction points add on top of it — and the
   leaderboard only shows a player once they REGISTER (see the `registered` gate). Scoring
   is otherwise unchanged. Idempotent: re-running recomputes the same values.

   Usage:
     node scripts/headstart-grant.js --dry-run   # preview, writes nothing
     node scripts/headstart-grant.js             # apply
*/
const { connect, collections, client } = require("../src/db");

const NEW_HEADSTART = 29;
const FLOOR = 13;
const norm = s => String(s || "").trim().toLowerCase();
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NEW_JOINERS = [
  ["Aditya Verma", "aditya.verma@calfus.com"],
  ["Almas Shaikh", "almas.shaikh@calfus.com"],
  ["Aman Kanamadi", "aman.kanamadi@calfus.com"],
  ["Amith Reddy Bhoomannagari", "amith.reddy@calfus.com"],
  ["Amith V", "amith.v@calfus.com"],
  ["Anvesha Vyas", "anvesha.vyas@calfus.com"],
  ["Asadkhan Pathan", "asadkhan.pathan@calfus.com"],
  ["Atharv Muchandi", "atharv.muchandi@calfus.com"],
  ["Chitalluru Srija", "srija.chittaluru@calfus.com"],
  ["Darshan Atkari", "darshan.atkari@calfus.com"],
  ["Dhiksha M", "dhiksha.m@calfus.com"],
  ["Jishnu Vooda", "jishnu.vooda@calfus.com"],
  ["Kalpesh Borse", "kalpesh.borse@calfus.com"],
  ["Kothakota SaiLaxmanRao", "kothakota.sailaxmanrao@calfus.com"],
  ["Kushal Chaudhari", "kushal.chaudhari@calfus.com"],
  ["Madhura Patil", "madhura.patil@calfus.com"],
  ["Mamatha Sara", "sara.mamatha@calfus.com"],
  ["Mansi Nataraj", "mansi.nataraj@calfus.com"],
  ["N Chaithra", "n.chaithra@calfus.com"],
  ["Prakrit Mohanty", "prakrit.mohanty@calfus.com"],
  ["Pranav Joshi", "pranav.joshi@calfus.com"],
  ["Pranay Bhagwat", "pranay.bhagwat@calfus.com"],
  ["Praveen Patil", "praveen.patil@calfus.com"],
  ["Sahil Ranadive", "sahil.ranadive@calfus.com"],
  ["Sakshi Borage", "sakshi.borage@calfus.com"],
  ["Sarayu Reddy", "sarayu.reddy@calfus.com"],
  ["Sathvik Tati", "sathvik.tati@calfus.com"],
  ["Shah Bhavya Heeren", "bhavya.shah@calfus.com"],
  ["Shravan Kulkarni", "shravan.kulkarni@calfus.com"],
  ["Shreeya D", "shreeya.d@calfus.com"],
  ["Shreya Deshpande", "shreya.deshpande@calfus.com"],
  ["Shreya Dhaytonde", "shreya.dhaytonde@calfus.com"],
  ["Shreya Phadke", "shreya.phadke@calfus.com"],
  ["Shruti Jain", "shruti.jain@calfus.com"],
  ["Sudhanshu Narvekar", "sudhanshu.narvekar@calfus.com"],
  ["Suhani Mittal", "suhani.mittal@calfus.com"],
  ["Swarna Nagasri Geethanjali", "swarna.nagasrigeethanjali@calfus.com"],
  ["Umer Bashir Sofi", "umer.sofi@calfus.com"],
  ["V Pruthvika", "v.pruthvika@calfus.com"],
  ["Vinit Patel", "vinit.patel@calfus.com"],
  ["Vishal Hota", "vishal.hota@calfus.com"],
  ["Wasiullah Rafeeq", "wasiullah.rafeeqs@calfus.com"],
  ["Yash Deshpande", "yash.deshpande@calfus.com"],
  ["Yogiraj Salunke", "yogiraj.salunke@calfus.com"],
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await connect();

  // 1) New joiners -> insert (or update) with a 29-point headstart.
  const newEmails = new Set(NEW_JOINERS.map(([, e]) => norm(e)));
  let added = 0, updatedNew = 0;
  for (const [name, email] of NEW_JOINERS) {
    const cleanName = name.replace(/\s+/g, " ").trim();
    const existing = await collections.employees().findOne({
      $or: [
        { Email: { $regex: `^${esc(email)}$`, $options: "i" } },
        { email: { $regex: `^${esc(email)}$`, $options: "i" } },
      ],
    });
    if (dryRun) { console.log(`[new]   ${cleanName} <${email}> -> headstart ${NEW_HEADSTART}${existing ? " (exists, update)" : " (insert)"}`); continue; }
    if (existing) { await collections.employees().updateOne({ _id: existing._id }, { $set: { headstart: NEW_HEADSTART } }); updatedNew++; }
    else { await collections.employees().insertOne({ Name: cleanName, Email: email, headstart: NEW_HEADSTART }); added++; }
  }

  // 2) Everyone else -> floor to 13 based on current (scored) prediction points.
  const emps = await collections.employees().find({}).toArray();
  const agg = await collections.predictions().aggregate([
    { $match: { scored: true } },
    { $group: { _id: "$employeeId", points: { $sum: "$points" } } },
  ]).toArray();
  const ptsById = new Map(agg.map(r => [String(r._id), r.points || 0]));
  let floored = 0, cleared = 0;
  for (const d of emps) {
    if (newEmails.has(norm(d.Email || d.email || ""))) continue;   // new joiners handled above
    const pts = ptsById.get(String(d._id)) || 0;
    const hs = pts < FLOOR ? FLOOR - pts : 0;
    if (dryRun) { if (hs) console.log(`[floor] ${d.Name || d.name || d.Email || d.email} pts=${pts} -> headstart ${hs}`); continue; }
    await collections.employees().updateOne({ _id: d._id }, { $set: { headstart: hs } });
    if (hs) floored++; else cleared++;
  }

  console.log(dryRun
    ? "(dry run — nothing written)"
    : `New joiners: ${added} inserted, ${updatedNew} updated (headstart ${NEW_HEADSTART}). Existing: ${floored} floored to ${FLOOR}, ${cleared} left at/above ${FLOOR}.`);
  await client.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
