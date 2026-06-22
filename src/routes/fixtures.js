const express = require("express");
const { collections } = require("../db");
const { requireAuth } = require("../auth");
const windows = require("../windows");
const config = require("../config");

const router = express.Router();

/** Join a fixture with team info and add predictable/locked flags.
    Predictions close LOCK_BEFORE_MIN minutes before kickoff (see windows.js). */
function enrich(fixture, teamsById) {
  const A = teamsById[fixture.teamAId] || {};
  const B = teamsById[fixture.teamBId] || {};
  const locked = windows.isLocked(fixture.kickoff);
  return {
    id: String(fixture._id),
    apiId: fixture.apiId,
    teamA: { id: fixture.teamAId, name: A.name, abbr: A.abbr, flag: A.flag },
    teamB: { id: fixture.teamBId, name: B.name, abbr: B.abbr, flag: B.flag },
    date: fixture.date,
    time: fixture.time,
    kickoff: fixture.kickoff,
    round: fixture.round,
    group: fixture.group,
    md: fixture.md,
    status: fixture.status || "scheduled",
    result: fixture.result || null,
    homeScore: fixture.homeScore ?? null,
    awayScore: fixture.awayScore ?? null,
    predictable: !locked,
    lockAt: windows.lockTime(fixture.kickoff).toISO(),
    locked,
  };
}

async function teamMap() {
  const teams = await collections.teams().find({}).toArray();
  return Object.fromEntries(teams.map(t => [t.id, t]));
}

// GET /api/window -> simple status (predictions are always open; per-fixture lock).
router.get("/window", requireAuth, (_req, res) => {
  res.json({ serverTime: windows.now().toISO(), open: true, lockBeforeMin: config.LOCK_BEFORE_MIN });
});

// GET /api/fixtures -> all fixtures, enriched
router.get("/fixtures", requireAuth, async (_req, res) => {
  try {
    const tmap = await teamMap();
    const docs = await collections.fixtures().find({}).sort({ kickoff: 1 }).toArray();
    res.json(docs.map(f => enrich(f, tmap)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/results -> the settled-scores ledger (most recent first)
router.get("/results", async (_req, res) => {
  try {
    const rows = await collections.settledScores().find({}).sort({ settledAt: -1 }).toArray();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/teams -> team list (for the dashboard badges)
router.get("/teams", async (_req, res) => {
  try { res.json(await collections.teams().find({}).toArray()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, enrich, teamMap };
