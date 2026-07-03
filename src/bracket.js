/* Knockout-bracket advancement.

   The R16→Final fixtures (apiId 89-104) are seeded with feeder refs
   (feedA / feedB = { m: <feeder apiId>, take: "W" | "L" }) instead of fixed teams.
   As each feeding match settles, we fill the dependent fixture's teamAId / teamBId
   from the winner (or the loser, for the third-place playoff). f.result already
   reflects the penalty-shootout winner, so a level-then-pens knockout advances the
   right team. Pure resolver (computeBracketUpdates) + a DB applier (advanceBracket). */
const { collections } = require("./db");

/** Winner/loser team ids for a settled fixture, or null if undecided. */
function winnerLoser(f) {
  if (!f || (f.result !== "win" && f.result !== "lose")) return null;
  return f.result === "win"
    ? { W: String(f.teamAId || ""), L: String(f.teamBId || "") }
    : { W: String(f.teamBId || ""), L: String(f.teamAId || "") };
}

/**
 * Given all fixtures, return the team-slot updates for any bracket fixture whose
 * feeders are now decided: { "89": { teamAId: "21" }, ... }.
 * Iterates to a fixpoint so one settle can cascade (a freshly-filled QF slot can in
 * turn fill a SF slot if that round is also ready).
 */
function computeBracketUpdates(fixtures) {
  const byApi = {};
  fixtures.forEach(f => { byApi[String(f.apiId)] = { ...f, teamAId: String(f.teamAId || ""), teamBId: String(f.teamBId || "") }; });

  let changed = true, guard = 0;
  while (changed && guard++ < 12) {
    changed = false;
    Object.values(byApi).forEach(f => {
      [["feedA", "teamAId"], ["feedB", "teamBId"]].forEach(([fk, tk]) => {
        const fd = f[fk];
        if (!fd) return;
        const wl = winnerLoser(byApi[String(fd.m)]);
        const tid = wl ? wl[fd.take] : null;
        if (tid && f[tk] !== tid) { f[tk] = tid; changed = true; }
      });
    });
  }

  const updates = {};
  fixtures.forEach(f => {
    const cur = byApi[String(f.apiId)], set = {};
    if (cur.teamAId && cur.teamAId !== String(f.teamAId || "")) set.teamAId = cur.teamAId;
    if (cur.teamBId && cur.teamBId !== String(f.teamBId || "")) set.teamBId = cur.teamBId;
    if (Object.keys(set).length) updates[String(f.apiId)] = set;
  });
  return updates;
}

/** Apply advancement against the DB (idempotent). Returns the number of slots filled. */
async function advanceBracket() {
  const fixtures = await collections.fixtures().find({}).toArray();
  const updates = computeBracketUpdates(fixtures);
  let n = 0;
  for (const [apiId, set] of Object.entries(updates)) {
    await collections.fixtures().updateOne({ apiId }, { $set: set });
    n += Object.keys(set).length;
  }
  if (n) console.log(`[bracket] advanced ${n} team slot(s)`);
  return n;
}

module.exports = { computeBracketUpdates, advanceBracket, winnerLoser };
