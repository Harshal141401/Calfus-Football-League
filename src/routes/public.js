// Public, read-only endpoints for the standalone TV / kiosk display (no auth).
// These mirror the authenticated read routes but expose only data that is safe
// to show on a shared screen, so a TV link needs no login.
const express = require("express");
const { collections } = require("../db");
const windows = require("../windows");
const config = require("../config");
const { enrich, teamMap, pickCounts } = require("./fixtures");

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

// GET /api/public/employees -> id + name (+ one-time headstart) for the TV leaderboard
router.get("/employees", async (_req, res) => {
  try {
    const [docs, creds] = await Promise.all([
      collections.employees().find({}).toArray(),
      collections.credentials().find({}, { projection: { employeeId: 1, email: 1 } }).toArray(),
    ]);
    const regIds = new Set(creds.map(c => String(c.employeeId)));
    const regEmails = new Set(creds.map(c => String(c.email || "").trim().toLowerCase()));
    const mapped = docs.map(d => {
      const joined = [d.firstName, d.lastName].filter(Boolean).join(" ");
      const name = d.Name || d.name || d.fullName || d.employeeName || d.username || joined || "Unknown";
      const email = String(d.Email || d.email || "").trim().toLowerCase();
      const registered = regIds.has(String(d._id)) || (!!email && regEmails.has(email));
      return { id: String(d._id), name, headstart: Number(d.headstart) || 0, registered };
    }).filter(e => e.id && e.name);
    res.json(mapped);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/public/fixtures -> all fixtures, enriched (same shape as /api/fixtures)
router.get("/fixtures", async (_req, res) => {
  try {
    const tmap = await teamMap();
    const docs = await collections.fixtures().find({}).sort({ kickoff: 1 }).toArray();
    const counts = await pickCounts();
    res.json(docs.map(f => ({ ...enrich(f, tmap), pickCount: counts[String(f._id)] || 0 })));
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
      penalty: !!p.penalty,
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
