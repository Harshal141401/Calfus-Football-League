/* Seed teams + fixtures into Mongo from the worldcup2026 CSV exports (the
   authoritative source). Idempotent: upserts by team id / fixture apiId, so
   existing _ids — and any predictions referencing them — are preserved.

   Flags: built from each team's iso2 via flagcdn (reliable, uniform). The old
   Wikipedia thumbnail URLs returned HTTP 400 and didn't render.

   Usage:  npm run seed                         (preserves settled results)
           npm run seed -- --reset-results       (also clears scores -> scheduled) */
const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");
const config = require("../src/config");
const { connect, collections, client } = require("../src/db");

const ROOT = path.join(__dirname, "..");
const TEAMS_CSV = path.join(ROOT, "worldcup2026.teams.csv");
const GAMES_CSV = path.join(ROOT, "worldcup2026.games.csv");

// --- minimal CSV parser (handles quoted fields with commas) ---
function parseCSV(text) {
  const rows = [];
  const lines = text.replace(/\r/g, "").trim().split("\n");
  const header = splitLine(lines[0]);
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i]; });
    rows.push(obj);
  }
  return rows;
}
function splitLine(line) {
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Resolved playoff slots (the CSV still lists these as "TBD"). Keyed by team id.
// Applied only while the CSV row is still TBD — once the CSV has real data, these
// are ignored. Flags derive from iso2 via flagcdn.
const PLAYOFF_RESULTS = {
  "4":  { name: "Czechia",                fifa_code: "CZE", iso2: "CZ" }, // UEFA Path D
  "6":  { name: "Bosnia & Herzegovina",   fifa_code: "BIH", iso2: "BA" }, // UEFA Path A
  "16": { name: "Türkiye",                fifa_code: "TUR", iso2: "TR" }, // UEFA Path C
  "23": { name: "Sweden",                 fifa_code: "SWE", iso2: "SE" }, // UEFA Path B
  "35": { name: "Iraq",                   fifa_code: "IRQ", iso2: "IQ" }, // IC Path 2
  "42": { name: "DR Congo",               fifa_code: "COD", iso2: "CD" }, // IC Path 1
};

// Build a reliable flag URL from an ISO-3166 alpha-2 code (flagcdn).
const ISO_OVERRIDES = { ENG: "gb-eng", SCO: "gb-sct", WAL: "gb-wls", NIR: "gb-nir" };
function flagUrl(iso2) {
  if (!iso2 || iso2 === "TBD") return "";
  const code = ISO_OVERRIDES[iso2] || iso2.toLowerCase();
  return `https://flagcdn.com/w160/${code}.png`;
}

async function main() {
  const resetResults = process.argv.includes("--reset-results");

  const teams = parseCSV(fs.readFileSync(TEAMS_CSV, "utf8"));
  const games = parseCSV(fs.readFileSync(GAMES_CSV, "utf8"));

  await connect();

  // --- teams ---
  let teamN = 0;
  for (const t of teams) {
    // Fill in resolved playoff slots while the CSV still says TBD.
    const resolved = (t.iso2 === "TBD") ? PLAYOFF_RESULTS[String(t.id)] : null;
    const name = resolved ? resolved.name : t.name_en;
    const fifa = resolved ? resolved.fifa_code : t.fifa_code;
    const iso2 = resolved ? resolved.iso2 : t.iso2;
    const isTBD = !iso2 || iso2 === "TBD";
    const doc = {
      id: String(t.id),
      name,
      abbr: fifa || "TBD",
      iso2: iso2 || "",
      group: t.groups || "",
      flag: flagUrl(iso2),
      // green/gold ring for real teams, neutral grey for undecided slots
      c1: isTBD ? "#3a3f44" : "#00FF88",
      c2: isTBD ? "#23272b" : "#FFD700",
    };
    await collections.teams().updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
    teamN++;
  }
  const withFlags = teams.filter(t => flagUrl(t.iso2)).length;
  console.log(`Seeded ${teamN} teams (${withFlags} with flags, ${teamN - withFlags} undecided slots)`);

  // --- fixtures ---
  let inserted = 0, updated = 0;
  for (const g of games) {
    const kickoff = DateTime.fromISO(g.date, { zone: "utc" });          // CSV date is UTC
    const ist = kickoff.setZone(config.FIXTURE_TZ);
    const round = g.type === "group"
      ? `Group ${g.group} · Matchday ${g.matchday}`
      : (g.type ? g.type[0].toUpperCase() + g.type.slice(1) : "Knockout");
    const base = {
      apiId: String(g.id),
      teamAId: String(g.home_team_id),
      teamBId: String(g.away_team_id),
      date: ist.toFormat("yyyy-LL-dd"),
      time: ist.toFormat("HH:mm"),
      kickoff: kickoff.toISO(),
      round, group: g.group || "", md: Number(g.matchday) || 0,
    };
    const existing = await collections.fixtures().findOne({ apiId: base.apiId });
    if (!existing) {
      await collections.fixtures().insertOne({ ...base, status: "scheduled", result: null });
      inserted++;
    } else if (resetResults) {
      await collections.fixtures().updateOne({ apiId: base.apiId },
        { $set: { ...base, status: "scheduled", result: null },
          $unset: { homeScore: "", awayScore: "", settledAt: "" } });
      updated++;
    } else {
      await collections.fixtures().updateOne({ apiId: base.apiId }, { $set: base });
      updated++;
    }
  }
  console.log(`Fixtures: ${inserted} inserted, ${updated} updated${resetResults ? " (results reset)" : ""}`);

  await client.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
