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

  // --- Prediction window (timezone-aware) ---
  WINDOW_TZ: env.WINDOW_TZ || "Asia/Kolkata",
  WINDOW_START: env.WINDOW_START || "10:00",        // HH:mm, inclusive
  WINDOW_END: env.WINDOW_END || "18:00",            // HH:mm, exclusive
  PREDICTION_DAYS: parseDays(env.PREDICTION_DAYS, [1, 4]),     // Mon, Thu
  // Coverage runs until the NEXT prediction day at this "early morning" cutoff (IST).
  // So Monday covers matches up to Thursday COVERAGE_END_TIME; Thursday up to Monday.
  COVERAGE_END_TIME: env.COVERAGE_END_TIME || "06:00",

  // Fixtures (date+time strings) are kickoff-in-IST per the dashboard data.
  FIXTURE_TZ: env.FIXTURE_TZ || "Asia/Kolkata",

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

module.exports = config;
