// Public, read-only endpoints for the standalone TV / kiosk display (no auth).
// These mirror the authenticated read routes but expose only data that is safe
// to show on a shared screen, so a TV link needs no login.
const express = require("express");
const { collections } = require("../db");
const windows = require("../windows");
const config = require("../config");
const { enrich, teamMap } = require("./fixtures");

const router = express.Router();

// GET /api/public/window
router.get("/window", (_req, res) => {
  res.json({ serverTime: windows.now().toISO(), open: true, lockBeforeMin: config.LOCK_BEFORE_MIN });
});

// GET /api/public/teams
router.get("/teams", async (_req, res) => {
  try { res.json(await collections.teams().find({}).toArray()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/public/employees -> id + name only (needed for the leaderboard)
router.get("/employees", async (_req, res) => {
  try {
    const docs = await collections.employees().find({}).toArray();
    const mapped = docs.map(d => {
      const joined = [d.firstName, d.lastName].filter(Boolean).join(" ");
      const name = d.Name || d.name || d.fullName || d.employeeName || d.username || joined || "Unknown";
      return { id: String(d._id), name };
    }).filter(e => e.id && e.name);
    res.json(mapped);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/public/fixtures -> all fixtures, enriched (same shape as /api/fixtures)
router.get("/fixtures", async (_req, res) => {
  try {
    const tmap = await teamMap();
    const docs = await collections.fixtures().find({}).sort({ kickoff: 1 }).toArray();
    res.json(docs.map(f => enrich(f, tmap)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/public/predictions -> picks, but HIDE any pick for a fixture that
// hasn't kicked off / settled yet (no per-user exception, since this is public).
router.get("/predictions", async (_req, res) => {
  try {
    const fixtures = await collections.fixtures().find({}, { projection: { kickoff: 1, status: 1 } }).toArray();
    const hiddenFixtureIds = new Set(
      fixtures
        .filter(f => f.status !== "settled" && !windows.hasKickedOff(f.kickoff))
        .map(f => String(f._id))
    );
    const all = await collections.predictions().find({}).toArray();
    const visible = all.filter(p => !hiddenFixtureIds.has(p.fixtureId));
    res.json(visible.map(p => ({
      employeeId: p.employeeId,
      fixtureId: p.fixtureId,
      choice: p.choice,
      scoreHome: p.scoreHome ?? null,
      scoreAway: p.scoreAway ?? null,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/public/champion -> the champion (if set) + everyone's picks once locked.
// Picks stay hidden until the Round of 16 begins (same privacy rule as match picks).
router.get("/champion", async (_req, res) => {
  try {
    const r16 = await collections.fixtures()
      .find({ round: { $regex: "round of 16", $options: "i" } }).toArray();
    const times = r16.map(f => new Date(f.kickoff).getTime()).filter(Number.isFinite);
    const lockAt = times.length ? Math.min(...times) : null;
    const locked = lockAt != null && Date.now() >= lockAt;
    const champDoc = await collections.settings().findOne({ _id: "champion" });
    const champion = champDoc && champDoc.teamId ? String(champDoc.teamId) : null;
    const picks = locked
      ? (await collections.championPicks().find({}).toArray())
          .map(p => ({ employeeId: p.employeeId, teamId: String(p.teamId) }))
      : [];
    res.json({ champion, locked, lockAt: lockAt != null ? new Date(lockAt).toISOString() : null, picks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
