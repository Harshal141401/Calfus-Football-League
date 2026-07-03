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

    // Fold each employee's one-time headstart (a permanent base-points grant) into their
    // row. Only players who have made a (scored) prediction appear — a headstart alone does
    // not put someone on the board; non-predictors stay stored in the DB, off the board.
    const emps = await collections.employees().find({}).toArray();
    const byId = new Map(agg.map(r => [String(r._id), r]));
    for (const d of emps) {
      const hs = Number(d.headstart) || 0;
      if (!hs) continue;
      const existing = byId.get(String(d._id));
      if (existing) { existing.points += hs; existing.headstart = hs; }   // predictor -> add base points
      // headstart-only (no scored predictions) -> not shown
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
