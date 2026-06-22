/* Prediction timing — predictions are open all the time; each fixture's pick
   closes LOCK_BEFORE_MIN minutes before its own kickoff (default 30).
   e.g. a 10:30 kickoff locks at 10:00 — that one match closes while every other
   match stays open until its own lock time. The lock instant is absolute (derived
   from the fixture's kickoff), identical for every user/timezone. */
const { DateTime } = require("luxon");
const config = require("./config");

/** Current instant as a luxon DateTime (timezone arg kept for callers; not used for gating). */
function now(tz = config.IST_TZ) {
  return DateTime.now().setZone(tz);
}

/** The instant a fixture's predictions close: LOCK_BEFORE_MIN before kickoff. */
function lockTime(kickoffISO) {
  return DateTime.fromISO(kickoffISO).minus({ minutes: config.LOCK_BEFORE_MIN });
}

/** Open for predictions until LOCK_BEFORE_MIN before kickoff. */
function isFixturePredictable(kickoffISO, _tz, dt = DateTime.now()) {
  return dt < lockTime(kickoffISO);
}

/** Locked (predictions closed) from LOCK_BEFORE_MIN before kickoff onward. */
function isLocked(kickoffISO, dt = DateTime.now()) {
  return dt >= lockTime(kickoffISO);
}

module.exports = {
  now, lockTime, isFixturePredictable, isLocked,
  // alias: callers historically used hasKickedOff to mean "locked / closed".
  hasKickedOff: isLocked,
};
