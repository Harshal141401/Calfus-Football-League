/* Per-office prediction-poll logic.
   Two polls a week (POLL_DAYS, e.g. Mon & Thu), each held in the office's OWN local
   noon–5pm session (POLL_OPEN..POLL_CLOSE). A poll "owns" the matches that kick off
   AFTER it closes, up to the next poll — so every covered match is still in the future
   while its poll runs. The hard lock is each match's own kickoff (hasKickedOff), one
   absolute instant identical for every office → no result-known voting, no advantage. */
const { DateTime } = require("luxon");
const config = require("./config");

function parseHHmm(s) {
  const [h, m] = s.split(":").map(n => parseInt(n, 10));
  return { hour: h, minute: m || 0 };
}

/** Current instant as a luxon DateTime, in the given office timezone (default IST). */
function now(tz = config.IST_TZ) {
  return DateTime.now().setZone(tz);
}

/**
 * The OPEN instant (POLL_OPEN, office-local) of the poll that owns a fixture for an
 * office in timezone `tz`: the latest POLL_DAY whose CLOSE (POLL_CLOSE) is <= kickoff.
 * Returns a luxon DateTime, or null if none found within 28 days back.
 */
function owningPollOpen(kickoffISO, tz = config.IST_TZ) {
  const open = parseHHmm(config.POLL_OPEN);
  const close = parseHHmm(config.POLL_CLOSE);
  const kickoff = DateTime.fromISO(kickoffISO).setZone(tz);
  for (let i = 0; i <= 28; i++) {
    const day = kickoff.minus({ days: i });
    if (!config.POLL_DAYS.includes(day.weekday)) continue;
    const closeAt = day.set({ ...close, second: 0, millisecond: 0 });
    if (closeAt <= kickoff) {
      return day.set({ ...open, second: 0, millisecond: 0 });
    }
  }
  return null;
}

/**
 * If `dt` falls inside an open poll session for `tz`, return that session's OPEN
 * instant (today POLL_OPEN); otherwise null. A session is POLL_OPEN..POLL_CLOSE on
 * a POLL_DAY — voting is ONLY allowed during this window.
 */
function currentSessionOpen(tz = config.IST_TZ, dt = now(tz)) {
  if (!config.POLL_DAYS.includes(dt.weekday)) return null;
  const open = parseHHmm(config.POLL_OPEN);
  const close = parseHHmm(config.POLL_CLOSE);
  const opensAt = dt.set({ ...open, second: 0, millisecond: 0 });
  const closesAt = dt.set({ ...close, second: 0, millisecond: 0 });
  return (dt >= opensAt && dt < closesAt) ? opensAt : null;
}

/**
 * Is `kickoffISO` predictable right now for an office in timezone `tz`?
 * Requires ALL of: (1) we are inside an open poll session, (2) the match belongs to
 * THIS session's batch (its owning poll == the current session), (3) it hasn't kicked
 * off. So predictions are only open Mon & Thu 12:00–17:00 office-local — locked otherwise.
 */
function isFixturePredictable(kickoffISO, tz = config.IST_TZ, dt = now(tz)) {
  const session = currentSessionOpen(tz, dt);
  if (!session) return false;                          // outside the Mon/Thu session → locked
  const owning = owningPollOpen(kickoffISO, tz);       // poll that owns this match
  if (!owning) return false;
  const kickoff = DateTime.fromISO(kickoffISO).setZone(tz);
  return owning.toMillis() === session.toMillis() && dt < kickoff;
}

/** Has the match kicked off? Picks are always locked from kickoff onward (absolute). */
function hasKickedOff(kickoffISO, dt = DateTime.now()) {
  return DateTime.fromISO(kickoffISO) <= dt;
}

/** ISO of the next poll OPEN instant strictly after `dt`, for the given timezone. */
function nextPollOpen(tz = config.IST_TZ, dt = now(tz)) {
  const open = parseHHmm(config.POLL_OPEN);
  for (let i = 0; i <= 14; i++) {
    const cand = dt.plus({ days: i }).set({ ...open, second: 0, millisecond: 0 });
    if (config.POLL_DAYS.includes(cand.weekday) && cand > dt) return cand.toISO();
  }
  return null;
}

/**
 * Poll status for an office (for the client banner). `open` is true during a poll's
 * session (POLL_OPEN..POLL_CLOSE) on a POLL_DAY — note that picks remain submittable
 * until each match's own kickoff regardless, but the session is the intended window.
 */
function pollStatus(tz = config.IST_TZ, dt = now(tz)) {
  const open = parseHHmm(config.POLL_OPEN);
  const close = parseHHmm(config.POLL_CLOSE);
  const isPollDay = config.POLL_DAYS.includes(dt.weekday);
  const opensAt = dt.set({ ...open, second: 0, millisecond: 0 });
  const closesAt = dt.set({ ...close, second: 0, millisecond: 0 });
  const sessionOpen = isPollDay && dt >= opensAt && dt < closesAt;
  return {
    tz,
    sessionOpen,
    opensAt: isPollDay ? opensAt.toISO() : null,
    closesAt: isPollDay ? closesAt.toISO() : null,
    nextOpen: nextPollOpen(tz, dt),
    pollOpen: config.POLL_OPEN,
    pollClose: config.POLL_CLOSE,
  };
}

module.exports = {
  now, owningPollOpen, isFixturePredictable, hasKickedOff, nextPollOpen, pollStatus,
};
