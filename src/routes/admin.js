const express = require("express");
const { ObjectId } = require("mongodb");
const { requireAdmin, issueAdminToken, checkAdminPassword } = require("../auth");
const { collections } = require("../db");
const { settleFixture, unsettleFixture } = require("../settle");

const router = express.Router();

// POST /api/admin/login  { password } -> { token }   (the only unguarded admin route)
router.post("/login", (req, res) => {
  const { password } = req.body || {};
  if (!checkAdminPassword(password)) return res.status(403).json({ error: "Wrong admin password" });
  res.json({ token: issueAdminToken() });
});

// Everything below requires admin auth.
router.use(requireAdmin);

function toObjectId(id) {
  try { return new ObjectId(id); } catch { return null; }
}

// POST /api/admin/fixtures/:id/settle  { homeScore, awayScore }
router.post("/fixtures/:id/settle", async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) return res.status(400).json({ error: "Invalid fixture id" });
  try {
    res.json(await settleFixture(_id, req.body.homeScore, req.body.awayScore));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/admin/fixtures/:id/unsettle  -> revert to scheduled, clear points
router.post("/fixtures/:id/unsettle", async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) return res.status(400).json({ error: "Invalid fixture id" });
  try { res.json(await unsettleFixture(_id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// GET /api/admin/predictions/:fixtureId -> everyone's picks for a fixture
router.get("/predictions/:fixtureId", async (req, res) => {
  try {
    const docs = await collections.predictions()
      .find({ fixtureId: req.params.fixtureId }).toArray();
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/champion  { teamId }  -> set the tournament champion (awards +25
// to everyone who picked that team). Pass an empty/absent teamId to clear it.
router.post("/champion", async (req, res) => {
  try {
    const teamId = (req.body && req.body.teamId) ? String(req.body.teamId) : null;
    await collections.settings().updateOne({ _id: "champion" },
      { $set: { teamId, at: new Date() } }, { upsert: true });
    res.json({ ok: true, champion: teamId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
