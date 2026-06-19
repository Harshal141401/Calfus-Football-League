const express = require("express");
const { ObjectId } = require("mongodb");
const { collections } = require("../db");
const { requireAuth } = require("../auth");
const windows = require("../windows");

const router = express.Router();
const VALID_CHOICES = ["win", "draw", "lose"];

function toObjectId(id) {
  try { return new ObjectId(id); } catch { return null; }
}

// Optional integer score >= 0, or null when omitted.
function parseScore(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return undefined; // undefined === invalid
  return n;
}

// POST /api/predictions  { fixtureId, choice, scoreHome?, scoreAway? }
// Upserts the caller's pick for a fixture. Gated by the prediction window + lock.
router.post("/predictions", requireAuth, async (req, res) => {
  try {
    const { fixtureId, choice } = req.body || {};
    if (!VALID_CHOICES.includes(choice)) {
      return res.status(400).json({ error: "choice must be one of win|draw|lose" });
    }
    const _id = toObjectId(fixtureId);
    if (!_id) return res.status(400).json({ error: "Invalid fixtureId" });

    const fixture = await collections.fixtures().findOne({ _id });
    if (!fixture) return res.status(404).json({ error: "Fixture not found" });

    // --- gating (per the caller's own office poll) ---
    const tz = req.user.tz;
    if (windows.hasKickedOff(fixture.kickoff)) {
      return res.status(409).json({ error: "Match has started — predictions are locked." });
    }
    if (!windows.isFixturePredictable(fixture.kickoff, tz)) {
      const opensAt = windows.owningPollOpen(fixture.kickoff, tz);
      return res.status(409).json({
        error: opensAt
          ? "This match isn't open for predictions yet — your poll opens before it."
          : "Predictions for this match are closed.",
        opensAt: opensAt ? opensAt.toISO() : null,
        poll: windows.pollStatus(tz),
      });
    }

    // score line is optional; require BOTH halves if either is given
    const scoreHome = parseScore(req.body.scoreHome);
    const scoreAway = parseScore(req.body.scoreAway);
    if (scoreHome === undefined || scoreAway === undefined) {
      return res.status(400).json({ error: "Scores must be non-negative integers." });
    }
    if ((scoreHome === null) !== (scoreAway === null)) {
      return res.status(400).json({ error: "Provide both scoreHome and scoreAway, or neither." });
    }

    const now = new Date();
    await collections.predictions().updateOne(
      { employeeId: req.user.id, fixtureId: String(_id) },
      {
        $set: {
          choice, scoreHome, scoreAway,
          employeeName: req.user.name, employeeEmail: req.user.email,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now, scored: false },
      },
      { upsert: true }
    );

    res.json({ ok: true, fixtureId: String(_id), choice, scoreHome, scoreAway });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/predictions -> predictions for rendering the board / stats / vote splits.
// Fairness: for fixtures that haven't kicked off, only the caller's own pick is
// exposed. Once a match has started (or is settled), everyone's picks are shown.
router.get("/predictions", requireAuth, async (req, res) => {
  try {
    const fixtures = await collections.fixtures().find({}, { projection: { kickoff: 1, status: 1 } }).toArray();
    const hiddenFixtureIds = new Set(
      fixtures
        .filter(f => f.status !== "settled" && !windows.hasKickedOff(f.kickoff))
        .map(f => String(f._id))
    );
    const all = await collections.predictions().find({}).toArray();
    const visible = all.filter(p => !hiddenFixtureIds.has(p.fixtureId) || p.employeeId === req.user.id);
    res.json(visible.map(p => ({
      employeeId: p.employeeId,
      fixtureId: p.fixtureId,
      choice: p.choice,
      scoreHome: p.scoreHome ?? null,
      scoreAway: p.scoreAway ?? null,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/predictions/me -> the caller's predictions
router.get("/predictions/me", requireAuth, async (req, res) => {
  try {
    const docs = await collections.predictions()
      .find({ employeeId: req.user.id }).toArray();
    res.json(docs.map(p => ({
      fixtureId: p.fixtureId, choice: p.choice,
      scoreHome: p.scoreHome ?? null, scoreAway: p.scoreAway ?? null,
      scored: !!p.scored, points: p.points ?? null,
      winCorrect: p.winCorrect ?? null, exactCorrect: p.exactCorrect ?? null,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
