/* Central configuration — everything tunable lives here and is env-driven.
   Window timing is intentionally left flexible (US + IST teams, common slot TBD):
   change WINDOW_TZ / WINDOW_START / WINDOW_END without touching code. */
require("dotenv").config();

const env = process.env;

// Parse "1,4" -> [1,4]  (luxon weekday numbers: Mon=1 ... Sun=7)
function parseDays(s, fallback) {
  if (!s) return fallback;
  return s.split(",").map(x => parseInt(x.trim(), 10)).filter(n => n >= 1 && n <= 7);
}

// Parse "1:4,4:7" -> { 1:4, 4:7 }  (open weekday -> coverage-end weekday)
function parseCoverage(s, fallback) {
  if (!s) return fallback;
  const map = {};
  for (const pair of s.split(",")) {
    const [day, end] = pair.split(":").map(x => parseInt(x.trim(), 10));
    if (day >= 1 && day <= 7 && end >= 1 && end <= 7) map[day] = end;
  }
  return Object.keys(map).length ? map : fallback;
}

const config = {
  // --- Mongo ---
  MONGODB_URI: env.MONGODB_URI,
  DB_NAME: env.DB_NAME || "employeeDetails",
  EMPLOYEES_COLLECTION: env.COLLECTION || "promptWars",

  // --- HTTP ---
  PORT: parseInt(env.PORT || "4000", 10),

  // --- Auth / sessions ---
  SESSION_SECRET: env.SESSION_SECRET || "dev-only-insecure-secret-change-me",
  SESSION_TTL_HOURS: parseInt(env.SESSION_TTL_HOURS || "12", 10),
  ADMIN_KEY: env.ADMIN_KEY || "",
  // Password for the in-browser admin login. Falls back to ADMIN_KEY if unset.
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || "",

  // --- Prediction polls (per-office, timezone-aware) ---
  // Two polls a week (Mon & Thu), held in EACH office's own local noon–5pm session.
  // A poll covers the matches that kick off AFTER it closes, until the next poll —
  // so every covered match is still in the future while its poll runs. The hard lock
  // is each match's own kickoff (see windows.hasKickedOff), identical for both offices.
  POLL_DAYS: parseDays(env.POLL_DAYS, [1, 4]),       // Mon, Thu (luxon weekday numbers)
  POLL_OPEN: env.POLL_OPEN || "12:00",               // HH:mm, poll session opens (office-local)
  POLL_CLOSE: env.POLL_CLOSE || "17:00",             // HH:mm, poll session closes (office-local)

  // Office → IANA timezone. India is IST; everyone else (US/USA/Canada/blank) is US Pacific.
  IST_TZ: env.IST_TZ || "Asia/Kolkata",
  US_TZ: env.US_TZ || "America/Los_Angeles",

  // Fixtures (date+time strings) are kickoff-in-IST per the dashboard data.
  FIXTURE_TZ: env.FIXTURE_TZ || "Asia/Kolkata",

  // Predictions are open all the time; each fixture locks this many minutes before kickoff.
  LOCK_BEFORE_MIN: parseInt(env.LOCK_BEFORE_MIN || "30", 10),

  // --- DEPRECATED (replaced by per-office polls above; kept only for reference) ---
  // WINDOW_TZ / WINDOW_START / WINDOW_END / COVERAGE_END_TIME were a single global
  // clock window. Predictability is now per-(office, fixture); see src/windows.js.
  WINDOW_TZ: env.WINDOW_TZ || "Asia/Kolkata",

  // --- Scoring ---
  POINTS: {
    WIN_CORRECT: parseInt(env.POINTS_WIN_CORRECT || "3", 10),
    WIN_WRONG: parseInt(env.POINTS_WIN_WRONG || "-1", 10),
    SCORE_CORRECT: parseInt(env.POINTS_SCORE_CORRECT || "5", 10),
    SCORE_WRONG: parseInt(env.POINTS_SCORE_WRONG || "-2", 10),
  },

  // --- Football API proxy (optional, kept from original server) ---
  WC_BASE: env.WC_BASE || "https://worldcup26.ir",
  WC_TOKEN: env.WC_TOKEN || "",
};

if (!config.MONGODB_URI) {
  console.error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
  process.exit(1);
}

/** Resolve an employee's Location to their poll timezone.
 *  India → IST; everyone else (US / USA / Canada / blank) → US Pacific. */
function officeTzFor(location) {
  return /india/i.test(String(location || "")) ? config.IST_TZ : config.US_TZ;
}

module.exports = config;
module.exports.officeTzFor = officeTzFor;
