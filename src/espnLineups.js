/* Fetch + parse starting XI from ESPN's match summary endpoint.
   parseLineup is a pure transform (unit-tested offline); fetchLineup does I/O.
   ESPN publishes lineups only ~1h before kickoff, so callers retry until present. */
function parseLineup(json) {
  const out = { home: [], away: [] };
  for (const r of json?.rosters || []) {
    const side = r.homeAway;
    if (side !== "home" && side !== "away") continue;
    out[side] = (r.roster || [])
      .filter(p => p.starter)
      .map(p => ({
        num: String(p.jersey || ""),
        name: p.athlete?.displayName || p.athlete?.shortName || "",
        pos: p.position?.abbreviation || "",
      }))
      .filter(p => p.name);
  }
  return out;
}

async function fetchLineup(espnId) {
  const config = require("./config");
  const base = config.ESPN_SUMMARY_BASE || config.ESPN_BASE.replace("scoreboard", "summary");
  const r = await fetch(`${base}?event=${encodeURIComponent(espnId)}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`ESPN summary ${r.status}`);
  return parseLineup(await r.json());
}

module.exports = { fetchLineup, parseLineup };
