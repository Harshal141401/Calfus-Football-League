const express = require("express");
const { collections } = require("../db");

const router = express.Router();

// GET /api/leaderboard -> standings aggregated live from scored predictions.
// Source of truth is predictions.points (written at settle time), so this can
// never drift and re-settling a fixture corrects the board automatically.
router.get("/leaderboard", async (_req, res) => {
  try {
    const rows = await collections.predictions().aggregate([
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
      { $sort: { points: -1, correct: -1, played: 1 } },
    ]).toArray();

    res.json(rows.map((r, i) => ({
      rank: i + 1,
      employeeId: r._id,
      name: r.name,
      email: r.email,
      points: r.points,
      played: r.played,
      correct: r.correct,
      wrong: r.wrong,
      exactHits: r.exactHits,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
