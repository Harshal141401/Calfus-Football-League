/* =============================================================================
   Calfus Football League — backend API
   Auth (Name+Email -> session), time-gated predictions (Mon/Thu windows),
   manual admin settlement, and a live leaderboard — all persisted in MongoDB.

   Run:
     npm install
     cp .env.example .env      # set MONGODB_URI, SESSION_SECRET, ADMIN_KEY
     npm run seed              # load teams + fixtures into Mongo (one time)
     npm start
   ========================================================================== */
const express = require("express");
const cors = require("cors");
const config = require("./src/config");
const { connect, collections } = require("./src/db");

const authRoutes = require("./src/routes/auth");
const { router: fixturesRoutes } = require("./src/routes/fixtures");
const predictionRoutes = require("./src/routes/predictions");
const leaderboardRoutes = require("./src/routes/leaderboard");
const adminRoutes = require("./src/routes/admin");

const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
// index:false so the "/" route below always serves the canonical source file
// (not a possibly-stale public/index.html copy).
app.use(express.static("public", { index: false }));
// Serve the dashboard at the root so it's same-origin with the API.
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "fifa-prediction-dashboard.html")));

// ---- health -----------------------------------------------------------------
app.get("/api/health", async (_req, res) => {
  try { await collections.employees().estimatedDocumentCount(); res.json({ status: "ok" }); }
  catch (e) { res.status(500).json({ status: "error", message: e.message }); }
});

// ---- employees (used by login UI / admin) -----------------------------------
function mapEmployee(doc) {
  const joined = [doc.firstName, doc.lastName].filter(Boolean).join(" ");
  const name = doc.Name || doc.name || doc.fullName || doc.employeeName || doc.username ||
    joined || doc.Email || doc.email || "Unknown";
  return { id: String(doc._id), name, email: doc.Email ?? doc.email ?? null };
}
app.get("/api/employees", async (_req, res) => {
  try {
    const docs = await collections.employees().find({}).toArray();
    res.json(docs.map(mapEmployee).filter(e => e.id && e.name));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- feature routes ----------------------------------------------------------
app.use("/api/auth", authRoutes);
app.use("/api", fixturesRoutes);       // /api/window, /api/fixtures, /api/teams
app.use("/api", predictionRoutes);     // /api/predictions, /api/predictions/me
app.use("/api", leaderboardRoutes);    // /api/leaderboard
app.use("/api/admin", adminRoutes);    // /api/admin/*

// ---- football API proxy (optional, kept from original) ----------------------
app.get("/api/wc/*", async (req, res) => {
  try {
    const reqPath = req.params[0];
    const headers = config.WC_TOKEN ? { Authorization: "Bearer " + config.WC_TOKEN } : {};
    const r = await fetch(`${config.WC_BASE}/${reqPath}`, { headers });
    const body = await r.text();
    res.status(r.status).type("application/json").send(body);
  } catch (e) { res.status(502).json({ error: "upstream fetch failed", message: e.message }); }
});

// ---- boot --------------------------------------------------------------------
connect()
  .then(() => app.listen(config.PORT, () =>
    console.log(`API on http://localhost:${config.PORT}`)))
  .catch(err => { console.error("Startup failed:", err); process.exit(1); });
