const express = require("express");
const {
  findEmployee, findEmployeeByEmail, hashPassword, verifyPassword,
  issueToken, requireAuth,
} = require("../auth");
const { collections } = require("../db");

const router = express.Router();
const norm = s => String(s || "").trim().toLowerCase();
const MIN_PW = 6;

// POST /api/auth/login  { email, password } -> { token, user }
// If the email is a valid employee but has no password yet, returns { needsSetup:true }.
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const emp = await findEmployeeByEmail(email);
    if (!emp) return res.status(401).json({ error: "No account found for that email." });

    const cred = await collections.credentials().findOne({ email: norm(email) });
    if (!cred) {
      // First time — client should switch to the set-password flow.
      return res.json({ needsSetup: true });
    }
    if (!(await verifyPassword(password, cred.passwordHash))) {
      return res.status(401).json({ error: "Incorrect password." });
    }
    res.json({ token: issueToken(emp), user: emp });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/set-password  { name, email, password }
// Used for first-time setup AND forgot-password reset. Identity is proven by the
// Name + Email pair matching an employee; then the password is (re)set and they're logged in.
router.post("/set-password", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required." });
    }
    if (String(password).length < MIN_PW) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PW} characters.` });
    }
    const emp = await findEmployee(name, email);   // name + email must match an employee
    if (!emp) {
      return res.status(401).json({ error: "Name and work email don't match an employee." });
    }
    const passwordHash = await hashPassword(password);
    const now = new Date();
    await collections.credentials().updateOne(
      { email: norm(email) },
      { $set: { email: norm(email), employeeId: emp.id, passwordHash, updatedAt: now },
        $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
    res.json({ token: issueToken(emp), user: emp });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/me  -> current session user
router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
