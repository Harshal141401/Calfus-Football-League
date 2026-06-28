/* Tournament-winner pick — the optional "who lifts the trophy" bet (+25 if right).
   Each player picks ONE team that's in the Round of 32. Editable until the first
   Round-of-16 match kicks off, then locked. The actual champion is set by an admin
   once the final is played; scoring (+25) happens client-side off that value. */
const express = require("express");
const { collections } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

/* The set of team ids playing in the Round of 32 (the only valid winner picks). */
async function r32TeamIds() {
  const fx = await collections.fixtures()
    .find({ round: { $regex: "round of 32", $options: "i" } }).toArray();
  const ids = new Set();
  fx.forEach(f => { ids.add(String(f.teamAId)); ids.add(String(f.teamBId)); });
  return ids;
}

/* Lock time = the first Round-of-16 kickoff (UTC ms), or null if none scheduled. */
async function r16StartMs() {
  const fx = await collections.fixtures()
    .find({ round: { $regex: "round of 16", $options: "i" } }).toArray();
  const times = fx.map(f => new Date(f.kickoff).getTime()).filter(t => Number.isFinite(t));
  return times.length ? Math.min(...times) : null;
}
async function lockState() {
  const start = await r16StartMs();
  const locked = start != null && Date.now() >= start;
  return { locked, lockAt: start != null ? new Date(start).toISOString() : null };
}

async function championTeamId() {
  const doc = await collections.settings().findOne({ _id: "champion" });
  return doc && doc.teamId ? String(doc.teamId) : null;
}

// GET /api/champion -> caller's pick + lock state + (after lock) everyone's picks + champion
router.get("/champion", requireAuth, async (req, res) => {
  try {
    const { locked, lockAt } = await lockState();
    const champion = await championTeamId();
    const mineDoc = await collections.championPicks().findOne({ employeeId: req.user.id });
    // Others' picks are hidden until locked (mirrors how match picks stay private pre-kickoff).
    const picks = locked
      ? (await collections.championPicks().find({}).toArray())
          .map(p => ({ employeeId: p.employeeId, teamId: String(p.teamId) }))
      : [];
    res.json({ mine: mineDoc ? String(mineDoc.teamId) : null, locked, lockAt, champion, picks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/champion { teamId } -> set/replace the caller's pick (blocked once locked)
router.post("/champion", requireAuth, async (req, res) => {
  try {
    const { locked } = await lockState();
    if (locked) return res.status(409).json({ error: "Winner picks are locked (Round of 16 has begun)." });
    const teamId = String((req.body && req.body.teamId) || "");
    const valid = await r32TeamIds();
    if (!valid.has(teamId)) return res.status(400).json({ error: "Pick a team that's in the Round of 32." });
    await collections.championPicks().updateOne(
      { employeeId: req.user.id },
      { $set: { employeeId: req.user.id, teamId, at: new Date() } },
      { upsert: true });
    res.json({ ok: true, mine: teamId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, lockState, championTeamId };
