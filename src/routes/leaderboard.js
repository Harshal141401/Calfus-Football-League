const express = require("express");
const { collections } = require("../db");

const router = express.Router();

// GET /api/leaderboard -> standings aggregated live from scored predictions.
// Source of truth is predictions.points (written at settle time), so this can
// never drift and re-settling a fixture corrects the board automatically.
router.get("/leaderboard", async (_req, res) => {
  try {
    const agg = await collections.predictions().aggregate([
      { $match: { scored: true } },
      { $group: {
          _id: "$employeeId",
          name: { $last: "$employeeName" },
          email: { $last: "$employeeEmail" },
          points: { $sum: "$points" },
          played: { $sum: 1 },
          correct: { $sum: { $cond: ["$winCorrect", 1, 0] } },
          wrong: { $sum: { $cond: ["$winCorrect", 0, 1] } },
          exactHits: { $sum: { $cond: ["$exactCorrect", 1, 0] } },
      } },
    ]).toArray();

    // Fold in each employee's one-time headstart (a permanent base-points grant). A
    // headstart-only player (no scored predictions) appears only once they've registered;
    // otherwise they stay stored in the DB but off the board.
    const [emps, creds] = await Promise.all([
      collections.employees().find({}).toArray(),
      collections.credentials().find({}, { projection: { employeeId: 1, email: 1 } }).toArray(),
    ]);
    const regIds = new Set(creds.map(c => String(c.employeeId)));
    const regEmails = new Set(creds.map(c => String(c.email || "").trim().toLowerCase()));
    const byId = new Map(agg.map(r => [String(r._id), r]));
    for (const d of emps) {
      const hs = Number(d.headstart) || 0;
      if (!hs) continue;
      const id = String(d._id);
      const existing = byId.get(id);
      if (existing) { existing.points += hs; existing.headstart = hs; continue; }   // predictor: registered already
      const email = String(d.Email || d.email || "").trim().toLowerCase();
      const registered = regIds.has(id) || (!!email && regEmails.has(email));
      if (!registered) continue;   // headstart-only + not signed up -> keep hidden
      const name = d.Name || d.name || d.fullName || d.employeeName || d.username ||
        [d.firstName, d.lastName].filter(Boolean).join(" ") || "Unknown";
      byId.set(id, { _id: id, name, email: d.Email ?? d.email ?? null,
        points: hs, headstart: hs, played: 0, correct: 0, wrong: 0, exactHits: 0 });
    }

    const rows = [...byId.values()].sort((a, b) =>
      (b.points - a.points) || (b.correct - a.correct) || (a.played - b.played));

    res.json(rows.map((r, i) => ({
      rank: i + 1,
      employeeId: r._id,
      name: r.name,
      email: r.email,
      points: r.points,
      headstart: r.headstart || 0,
      played: r.played,
      correct: r.correct,
      wrong: r.wrong,
      exactHits: r.exactHits,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
