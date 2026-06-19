const express = require("express");
const { collections } = require("../db");
const { requireAuth } = require("../auth");
const windows = require("../windows");
const config = require("../config");

const router = express.Router();

/** Join a fixture with team info and add predictable/locked flags for office `tz`. */
function enrich(fixture, teamsById, tz = config.IST_TZ) {
  const A = teamsById[fixture.teamAId] || {};
  const B = teamsById[fixture.teamBId] || {};
  const locked = windows.hasKickedOff(fixture.kickoff);
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
    predictable: !locked && windows.isFixturePredictable(fixture.kickoff, tz),
    opensAt: windows.owningPollOpen(fixture.kickoff, tz)?.toISO() || null,
    locked,
  };
}

async function teamMap() {
  const teams = await collections.teams().find({}).toArray();
  return Object.fromEntries(teams.map(t => [t.id, t]));
}

// GET /api/window -> the caller's office poll state (for banner / countdowns)
router.get("/window", requireAuth, (req, res) => {
  const tz = req.user.tz || config.IST_TZ;
  res.json({ serverTime: windows.now(tz).toISO(), ...windows.pollStatus(tz) });
});

// GET /api/fixtures -> all fixtures, enriched for the caller's office timezone
router.get("/fixtures", requireAuth, async (req, res) => {
  try {
    const tz = req.user.tz || config.IST_TZ;
    const tmap = await teamMap();
    const docs = await collections.fixtures().find({}).sort({ kickoff: 1 }).toArray();
    res.json(docs.map(f => enrich(f, tmap, tz)));
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
