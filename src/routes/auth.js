const express = require("express");
const { findEmployee, issueToken, requireAuth } = require("../auth");

const router = express.Router();

// POST /api/auth/login  { name, email } -> { token, user }
router.post("/login", async (req, res) => {
  try {
    const { name, email } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: "name and email are required" });

    const emp = await findEmployee(name, email);
    if (!emp) {
      return res.status(401).json({ error: "No matching employee. Check your name and work email." });
    }
    res.json({ token: issueToken(emp), user: emp });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/me  -> current session user
router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
