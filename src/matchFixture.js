/* Pure ESPN-event → fixture matching. No I/O, no config — unit-tested offline. */

// FIFA(seed) -> ESPN abbreviation fixes. Fill from "[espn] unmatched" logs as needed.
const ESPN_ABBR_OVERRIDES = {};

function normAbbr(a) {
  const u = String(a || "").toUpperCase();
  return ESPN_ABBR_OVERRIDES[u] || u;
}
function dayUtc(iso) { return String(iso || "").slice(0, 10); }

/** Match one normalized ESPN event to a fixture (same UTC day + unordered abbr/name pair).
 *  Returns { fixture, homeScore, awayScore } with scores mapped to fixture's Team A / Team B,
 *  or null if no fixture matches. teamsById: { [teamId]: {abbr,name} }. */
function matchFixture(event, fixtures, teamsById) {
  const evAbbrs = [normAbbr(event.home.abbr), normAbbr(event.away.abbr)].sort();
  const evNames = [event.home.name, event.away.name].map(s => s.toLowerCase()).sort();

  for (const f of fixtures) {
    if (dayUtc(f.kickoff) !== dayUtc(event.dateUtc)) continue;
    const A = teamsById[String(f.teamAId)] || {};
    const B = teamsById[String(f.teamBId)] || {};
    const fAbbrs = [normAbbr(A.abbr), normAbbr(B.abbr)].sort();
    const fNames = [String(A.name || "").toLowerCase(), String(B.name || "").toLowerCase()].sort();
    const abbrHit = fAbbrs[0] && fAbbrs[0] === evAbbrs[0] && fAbbrs[1] === evAbbrs[1];
    const nameHit = fNames[0] && fNames[0] === evNames[0] && fNames[1] === evNames[1];
    if (!abbrHit && !nameHit) continue;

    // Map ESPN scores to Team A / Team B by team identity (not ESPN home/away).
    const aIsHome = normAbbr(A.abbr) === normAbbr(event.home.abbr) ||
      String(A.name || "").toLowerCase() === event.home.name.toLowerCase();
    return {
      fixture: f,
      homeScore: aIsHome ? event.home.score : event.away.score,
      awayScore: aIsHome ? event.away.score : event.home.score,
    };
  }
  return null;
}

module.exports = { matchFixture, dayUtc, ESPN_ABBR_OVERRIDES };
