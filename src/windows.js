/* Timezone-aware prediction-window logic.
   A window is open on configured weekdays within [WINDOW_START, WINDOW_END).
   Each open day has a "coverage horizon" — the last instant whose fixtures are
   predictable in that window (Mon -> end of Thu, Thu -> end of Sun by default). */
const { DateTime } = require("luxon");
const config = require("./config");

function parseHHmm(s) {
  const [h, m] = s.split(":").map(n => parseInt(n, 10));
  return { hour: h, minute: m || 0 };
}

/** Current instant as a luxon DateTime in the window timezone. */
function now() {
  return DateTime.now().setZone(config.WINDOW_TZ);
}

/**
 * Describe the prediction window relative to `dt` (defaults to now).
 * Returns { open, opensAt, closesAt, coverageEnd } as ISO strings (or null).
 */
/**
 * Coverage horizon: the NEXT prediction day (after the most recent one on/before
 * `dt`) at COVERAGE_END_TIME. So Mon/Tue/Wed -> Thursday early morning; Thu/Fri/Sat/Sun
 * -> Monday early morning. Catches late-night-IST matches before the next window.
 */
function coverageEndFor(dt) {
  const cutoff = parseHHmm(config.COVERAGE_END_TIME);
  // most recent prediction day on/before today
  let anchor = dt;
  for (let i = 0; i <= 7; i++) {
    const c = dt.minus({ days: i });
    if (config.PREDICTION_DAYS.includes(c.weekday)) { anchor = c; break; }
  }
  // next prediction day strictly after the anchor's date
  for (let i = 1; i <= 7; i++) {
    const c = anchor.plus({ days: i });
    if (config.PREDICTION_DAYS.includes(c.weekday)) {
      return c.set({ ...cutoff, second: 0, millisecond: 0 });
    }
  }
  return dt.plus({ days: 7 }); // fallback (no prediction days configured)
}

function windowStatus(dt = now()) {
  const start = parseHHmm(config.WINDOW_START);
  const end = parseHHmm(config.WINDOW_END);
  const isPredictionDay = config.PREDICTION_DAYS.includes(dt.weekday);

  const coverageEnd = coverageEndFor(dt).toISO();

  if (!isPredictionDay) {
    return { open: false, opensAt: nextOpening(dt), closesAt: null, coverageEnd };
  }

  const opensAt = dt.set({ ...start, second: 0, millisecond: 0 });
  const closesAt = dt.set({ ...end, second: 0, millisecond: 0 });
  const open = dt >= opensAt && dt < closesAt;

  return {
    open,
    opensAt: opensAt.toISO(),
    closesAt: closesAt.toISO(),
    coverageEnd,
  };
}

/** ISO of the next time the window opens after `dt`, scanning up to 14 days. */
function nextOpening(dt) {
  const start = parseHHmm(config.WINDOW_START);
  for (let i = 0; i <= 14; i++) {
    const cand = dt.plus({ days: i }).set({ ...start, second: 0, millisecond: 0 });
    if (config.PREDICTION_DAYS.includes(cand.weekday) && cand > dt) return cand.toISO();
  }
  return null;
}

/**
 * Is `kickoffISO` predictable right now?
 * Requires: window open, kickoff in the future, kickoff within coverage horizon.
 */
function isFixturePredictable(kickoffISO, dt = now()) {
  const w = windowStatus(dt);
  if (!w.open) return false;
  const kickoff = DateTime.fromISO(kickoffISO, { zone: config.WINDOW_TZ });
  const coverageEnd = DateTime.fromISO(w.coverageEnd);
  return kickoff > dt && kickoff <= coverageEnd;
}

/** Has the match kicked off? Picks are always locked from kickoff onward. */
function hasKickedOff(kickoffISO, dt = now()) {
  return DateTime.fromISO(kickoffISO) <= dt;
}

module.exports = { now, windowStatus, nextOpening, isFixturePredictable, hasKickedOff };
