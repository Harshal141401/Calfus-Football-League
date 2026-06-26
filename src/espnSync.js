/* Match ESPN events to fixtures, write live scores, and auto-settle finals.
   matchFixture is pure (unit-tested); runSync/startPoller do I/O. */
const config = require("./config");
const { collections } = require("./db");
const { fetchScoreboard, parseEvents } = require("./espn");
const { matchFixture, dayUtc } = require("./matchFixture");
const { settleFixture } = require("./settle");
const { notifyPredictors } = require("./notify");
const { fetchLineup, fetchMatchEvents } = require("./espnLineups");

/* Fetch the starting XI for a matched event (once it's available) and store it on
   the fixture, mapped to Team A / Team B. Retries each tick until ESPN publishes it. */
async function syncLineup(ev, f, teamsById) {
  if (f.lineups || !(ev.state === "in" || ev.completed)) return;
  try {
    const lu = await fetchLineup(ev.espnId);
    if (!lu.home.length && !lu.away.length) return;   // not published yet — retry later
    const A = teamsById[String(f.teamAId)] || {};
    const aIsHome = String(A.abbr || "").toUpperCase() === String(ev.home.abbr || "").toUpperCase()
      || String(A.name || "").toLowerCase() === String(ev.home.name || "").toLowerCase();
    const lineups = aIsHome ? { teamA: lu.home, teamB: lu.away } : { teamA: lu.away, teamB: lu.home };
    await collections.fixtures().updateOne({ _id: f._id }, { $set: { lineups, lineupsAt: new Date() } });
    f.lineups = lineups;
    console.log(`[espn] lineups stored for ${f.apiId}`);
  } catch (e) { console.warn("[espn] lineup fetch failed:", e.message); }
}

/* Fetch goals + cards for a live/finished match and store them on the fixture,
   mapped to Team A / Team B. Refreshes while live; stops once stored as final. */
async function syncEvents(ev, f, teamsById) {
  if (!(ev.state === "in" || ev.completed)) return;
  if (f.eventsFinal) return;                       // already captured the final set
  try {
    const raw = await fetchMatchEvents(ev.espnId);
    if (!raw.length && !ev.completed) return;      // nothing yet — retry next tick
    const A = teamsById[String(f.teamAId)] || {};
    const aIsHome = String(A.abbr || "").toUpperCase() === String(ev.home.abbr || "").toUpperCase()
      || String(A.name || "").toLowerCase() === String(ev.home.name || "").toLowerCase();
    const events = raw.map(e => ({
      type: e.type, minute: e.minute, player: e.player, own: e.own,
      team: e.side === "home" ? (aIsHome ? "A" : "B") : e.side === "away" ? (aIsHome ? "B" : "A") : "",
    }));
    await collections.fixtures().updateOne({ _id: f._id },
      { $set: { events, eventsAt: new Date(), ...(ev.completed ? { eventsFinal: true } : {}) } });
    f.events = events;
    console.log(`[espn] ${events.length} events stored for ${f.apiId}${ev.completed ? " (final)" : ""}`);
  } catch (e) { console.warn("[espn] events fetch failed:", e.message); }
}

async function runSync() {
  const json = await fetchScoreboard();
  const events = parseEvents(json);
  if (!events.length) return;

  const fixtures = await collections.fixtures().find({}).toArray();
  const teams = await collections.teams().find({}).toArray();
  const teamsById = Object.fromEntries(teams.map(t => [String(t.id), t]));

  for (const ev of events) {
    const m = matchFixture(ev, fixtures, teamsById);
    if (!m) { console.warn(`[espn] unmatched: ${ev.home.abbr} vs ${ev.away.abbr} (${dayUtc(ev.dateUtc)})`); continue; }
    const f = m.fixture;
    const hasScore = Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore);

    if (ev.completed && hasScore) {
      // Settle once (skip if admin already settled). Notify is gated separately so a
      // failed email retries next tick even though the fixture is already settled.
      if (f.status === "scheduled") {
        await settleFixture(f._id, m.homeScore, m.awayScore);
        f.status = "settled";
        console.log(`[espn] auto-settled ${f.apiId}: ${m.homeScore}-${m.awayScore}`);
      }
      if (f.status === "settled" && !f.notifiedAt) {
        await notifyPredictors(f._id);
        await collections.fixtures().updateOne({ _id: f._id }, { $set: { notifiedAt: new Date() } });
      }
    } else if (ev.state === "in" && hasScore && f.status !== "settled") {
      await collections.fixtures().updateOne({ _id: f._id }, { $set: {
        liveStatus: "in", liveHomeScore: m.homeScore, liveAwayScore: m.awayScore,
        liveClock: ev.clock, liveUpdatedAt: new Date(),
      } });
    }
    await syncLineup(ev, f, teamsById);   // store starting XI when available
    await syncEvents(ev, f, teamsById);   // store goals + cards when available
  }
}

/* One-off (idempotent) sweep to fetch the starting XI + goals/cards for EVERY
   played fixture, not just the handful in today's default scoreboard. Walks each
   fixture's match date, pulls that date's scoreboard, matches, and stores lineups
   + events. Guarded by `lineups`/`eventsFinal`, so captured matches are skipped. */
async function backfillEvents() {
  const fixtures = await collections.fixtures().find({}).toArray();
  const teams = await collections.teams().find({}).toArray();
  const teamsById = Object.fromEntries(teams.map(t => [String(t.id), t]));
  const need = fixtures.filter(f => (f.status === "settled" || f.result) && (!f.eventsFinal || !f.lineups));
  if (!need.length) return;
  const dates = [...new Set(need.map(f => dayUtc(f.kickoff).replace(/-/g, "")))].filter(d => d.length === 8);
  console.log(`[espn] backfill: ${need.length} fixtures over ${dates.length} dates`);
  for (const d of dates) {
    let json;
    try { json = await fetchScoreboard(d); }
    catch (e) { console.warn(`[espn] backfill scoreboard ${d}:`, e.message); continue; }
    for (const ev of parseEvents(json)) {
      if (!ev.completed) continue;
      const m = matchFixture(ev, need, teamsById);
      if (!m) continue;
      await syncLineup(ev, m.fixture, teamsById);                       // starting XI
      if (!m.fixture.eventsFinal) await syncEvents(ev, m.fixture, teamsById);  // goals + cards
    }
  }
  console.log("[espn] backfill done");
}

function startPoller() {
  if (!config.ESPN_POLL_ENABLED) { console.log("[espn] poller disabled (ESPN_POLL_ENABLED!=true)"); return; }
  const tick = () => runSync().catch(e => console.error("[espn] sync error:", e.message));
  setInterval(tick, config.ESPN_POLL_SEC * 1000);
  tick();
  // Sweep historical fixtures for events once at startup (idempotent).
  backfillEvents().catch(e => console.error("[espn] backfill error:", e.message));
  console.log(`[espn] poller started, every ${config.ESPN_POLL_SEC}s`);
}

module.exports = { runSync, startPoller, backfillEvents };
