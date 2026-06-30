/* Fetch + normalize the ESPN soccer scoreboard. Pure-ish: fetchScoreboard does I/O,
   parseEvents is a pure transform (unit-tested offline). config is required lazily so
   parseEvents stays import-free of DB/env. */
async function fetchScoreboard(dateYYYYMMDD) {
  const config = require("./config");
  const url = dateYYYYMMDD ? `${config.ESPN_BASE}?dates=${dateYYYYMMDD}` : config.ESPN_BASE;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`ESPN ${r.status}`);
  return r.json();
}

/** Map ESPN scoreboard JSON to normalized events. Drops malformed entries. */
function parseEvents(json) {
  const out = [];
  for (const e of json?.events || []) {
    const comp = e.competitions?.[0];
    const status = e.status?.type || {};
    if (!comp || !Array.isArray(comp.competitors)) continue;
    const home = comp.competitors.find(c => c.homeAway === "home");
    const away = comp.competitors.find(c => c.homeAway === "away");
    if (!home || !away) continue;
    out.push({
      espnId: String(e.id),
      dateUtc: e.date,
      state: status.state || "pre",       // pre | in | post
      completed: status.completed === true,
      clock: e.status?.displayClock || "",
      home: side(home),
      away: side(away),
    });
  }
  return out;
}

function side(c) {
  return {
    abbr: (c.team?.abbreviation || "").toUpperCase(),
    name: c.team?.displayName || c.team?.name || "",
    score: Number(c.score),
    // Penalty-shootout score, when the match was decided on penalties (else null).
    shootout: (c.shootoutScore != null && c.shootoutScore !== "") ? Number(c.shootoutScore) : null,
  };
}

module.exports = { fetchScoreboard, parseEvents };
