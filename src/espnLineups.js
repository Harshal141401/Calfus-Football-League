/* Fetch + parse starting XI from ESPN's match summary endpoint, enriched with each
   player's club. parseLineup is a pure transform (unit-tested offline); fetchLineup
   does I/O. ESPN publishes lineups only ~1h before kickoff, so callers retry until present.

   Club isn't in the summary roster — it lives on the per-athlete endpoint as `defaultTeam`
   (the player's club, isNational=false). We resolve it once per athlete and cache the
   result in Mongo (athleteClubs), since clubs don't change over the tournament. */
const ATHLETE_BASE = "https://sports.core.api.espn.com/v2/sports/soccer/athletes";

function parseLineup(json) {
  const out = { home: [], away: [] };
  for (const r of json?.rosters || []) {
    const side = r.homeAway;
    if (side !== "home" && side !== "away") continue;
    out[side] = (r.roster || [])
      .filter(p => p.starter)
      .map(p => ({
        id: String(p.athlete?.id || ""),
        num: String(p.jersey || ""),
        name: p.athlete?.displayName || p.athlete?.shortName || "",
        pos: p.position?.abbreviation || "",
      }))
      .filter(p => p.name);
  }
  return out;
}

async function getJson(url) {
  const r = await fetch(String(url).replace(/^http:/, "https:"), { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`ESPN ${r.status}`);
  return r.json();
}

/* Live resolve of an athlete's club via ESPN core API. Returns "" if none / national team
   / any failure — club is purely cosmetic, so it must never break a lineup fetch. */
async function resolveClub(athleteId) {
  try {
    const a = await getJson(`${ATHLETE_BASE}/${encodeURIComponent(athleteId)}`);
    if (!a.defaultTeam?.$ref) return "";
    const t = await getJson(a.defaultTeam.$ref);
    if (t.isNational) return "";                 // their World Cup side, not a club
    return t.shortDisplayName || t.name || t.displayName || "";
  } catch (e) { return ""; }
}

/* Club for an athlete, memoised in Mongo (presence of a doc = resolved, even if ""). */
async function clubFor(athleteId) {
  if (!athleteId) return "";
  let cache = null;
  try { cache = require("./db").collections.athleteClubs(); } catch (e) { /* db not ready */ }
  if (cache) {
    const hit = await cache.findOne({ _id: athleteId });
    if (hit) return hit.club || "";
  }
  const club = await resolveClub(athleteId);
  if (cache) {
    try { await cache.updateOne({ _id: athleteId }, { $set: { club, at: new Date() } }, { upsert: true }); }
    catch (e) { /* cache write is best-effort */ }
  }
  return club;
}

/* Fill `club` on each player, a few at a time so one fixture's XI resolves in a couple
   of rounds rather than 11 sequential round-trips. Mutates the array in place. */
async function enrichClubs(players) {
  const LIMIT = 5;
  let next = 0;
  async function worker() {
    while (next < players.length) {
      const p = players[next++];
      p.club = await clubFor(p.id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, players.length) }, worker));
  return players;
}

async function fetchLineup(espnId) {
  const config = require("./config");
  const base = config.ESPN_SUMMARY_BASE || config.ESPN_BASE.replace("scoreboard", "summary");
  const r = await fetch(`${base}?event=${encodeURIComponent(espnId)}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`ESPN summary ${r.status}`);
  const lineup = parseLineup(await r.json());
  await Promise.all([enrichClubs(lineup.home), enrichClubs(lineup.away)]);
  return lineup;
}

/* Pull the scorer's name out of ESPN's free-text event description, since
   `athletesInvolved` is often empty. The player sits right before the "(Team)" part,
   after the score sentence — e.g. "Goal! A 0, B 1. Nicolas Pépé (B) left footed…". */
function playerFromText(text) {
  if (!text) return "";
  const idx = text.indexOf("(");
  if (idx < 0) return "";
  const head = text.slice(0, idx).trim();
  const parts = head.split(/[.!]/);
  return parts[parts.length - 1].trim();
}

/* Parse goals + red/yellow cards from a match-summary JSON, tagged home/away. */
function parseMatchEvents(json) {
  const comp = json && json.header && json.header.competitions && json.header.competitions[0];
  const sideById = {};
  for (const c of (comp && comp.competitors) || []) {
    sideById[String(c.id || (c.team && c.team.id))] = c.homeAway;
  }
  const out = [];
  for (const k of (json && json.keyEvents) || []) {
    if (k.shootout === true) continue;   // exclude penalty-shootout kicks from the goals list
    const t = ((k.type && k.type.text) || "").toLowerCase();
    let type = null;
    if (k.scoringPlay || t.includes("goal")) type = "goal";
    else if (t.includes("red card")) type = "red";
    else if (t.includes("yellow card")) type = "yellow";
    else continue;
    const player = (k.athletesInvolved && k.athletesInvolved[0] &&
      (k.athletesInvolved[0].displayName || k.athletesInvolved[0].shortName)) || playerFromText(k.text);
    if (!player) continue;
    out.push({
      type,
      minute: (k.clock && k.clock.displayValue) || "",
      player,
      side: sideById[String(k.team && k.team.id)] || "",
      own: /own goal/i.test(k.text || ""),
    });
  }
  return out;
}

/* Did the match go to a penalty shootout? ESPN tags shootout events with shootout:true. */
function wentToPenalties(json) {
  return ((json && json.keyEvents) || []).some(k =>
    k.shootout === true || /penalt(y|ies).*(shoot)/i.test((k.type && k.type.text) || ""));
}

async function fetchMatchEvents(espnId) {
  const config = require("./config");
  const base = config.ESPN_SUMMARY_BASE || config.ESPN_BASE.replace("scoreboard", "summary");
  const r = await fetch(`${base}?event=${encodeURIComponent(espnId)}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`ESPN summary ${r.status}`);
  const json = await r.json();
  return { events: parseMatchEvents(json), penalties: wentToPenalties(json) };
}

module.exports = { fetchLineup, parseLineup, enrichClubs, resolveClub, parseMatchEvents, wentToPenalties, fetchMatchEvents };
