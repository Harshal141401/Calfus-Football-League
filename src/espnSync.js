/* Match ESPN events to fixtures, write live scores, and auto-settle finals.
   matchFixture is pure (unit-tested); runSync/startPoller do I/O. */
const config = require("./config");
const { collections } = require("./db");
const { fetchScoreboard, parseEvents } = require("./espn");
const { matchFixture, dayUtc } = require("./matchFixture");
const { settleFixture } = require("./settle");
const { notifyPredictors } = require("./notify");

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
  }
}

function startPoller() {
  if (!config.ESPN_POLL_ENABLED) { console.log("[espn] poller disabled (ESPN_POLL_ENABLED!=true)"); return; }
  const tick = () => runSync().catch(e => console.error("[espn] sync error:", e.message));
  setInterval(tick, config.ESPN_POLL_SEC * 1000);
  tick();
  console.log(`[espn] poller started, every ${config.ESPN_POLL_SEC}s`);
}

module.exports = { runSync, startPoller };
