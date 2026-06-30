/* Settlement service — admin records a final scoreline; we write the result
   onto the fixture and award points to every prediction for that fixture.
   Idempotent: re-settling re-scores all predictions from scratch, so a corrected
   scoreline simply overwrites the previous points (no double counting). */
const { collections } = require("./db");
const { resultWithPens, scorePrediction } = require("./scoring");

async function settleFixture(fixtureId, homeScore, awayScore, penalties, penaltyHome, penaltyAway) {
  const fixtures = collections.fixtures();
  const fixture = await fixtures.findOne({ _id: fixtureId });
  if (!fixture) throw new Error("Fixture not found");

  const h = Number(homeScore), a = Number(awayScore);
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
    throw new Error("Scores must be non-negative integers");
  }
  // Whether the match went to penalties + the shootout score. Honour explicit
  // values; otherwise keep whatever was already on the fixture (e.g. from ESPN).
  const pen = penalties === undefined ? !!fixture.penalties : !!penalties;
  const ph = penaltyHome === undefined ? (fixture.penaltyHome ?? null) : (penaltyHome == null ? null : Number(penaltyHome));
  const pa = penaltyAway === undefined ? (fixture.penaltyAway ?? null) : (penaltyAway == null ? null : Number(penaltyAway));

  // Knockouts decided on penalties: the shootout (not the level score) sets the winner.
  const result = resultWithPens({ homeScore: h, awayScore: a, penalties: pen, penaltyHome: ph, penaltyAway: pa });
  await fixtures.updateOne(
    { _id: fixtureId },
    { $set: { homeScore: h, awayScore: a, result, penalties: pen, penaltyHome: ph, penaltyAway: pa, status: "settled", settledAt: new Date() } }
  );

  // Re-score every prediction for this fixture.
  const preds = await collections.predictions().find({ fixtureId: String(fixtureId) }).toArray();
  let scored = 0;
  for (const p of preds) {
    const s = scorePrediction(p, { homeScore: h, awayScore: a, penalties: pen, penaltyHome: ph, penaltyAway: pa });
    await collections.predictions().updateOne(
      { _id: p._id },
      { $set: {
          scored: true,
          points: s.points,
          winPoints: s.winPoints,
          scorePoints: s.scorePoints,
          winCorrect: s.winCorrect,
          exactCorrect: s.exactCorrect,
          scoredAt: new Date(),
      } }
    );
    scored++;
  }

  // Write a readable record to the settled-scores ledger (upsert by fixtureId).
  const [teamA, teamB] = await Promise.all([
    collections.teams().findOne({ id: String(fixture.teamAId) }),
    collections.teams().findOne({ id: String(fixture.teamBId) }),
  ]);
  await collections.settledScores().updateOne(
    { fixtureId: String(fixtureId) },
    { $set: {
        fixtureId: String(fixtureId),
        apiId: fixture.apiId,
        round: fixture.round, group: fixture.group, md: fixture.md,
        kickoff: fixture.kickoff,
        teamAId: String(fixture.teamAId), teamBId: String(fixture.teamBId),
        teamA: teamA ? teamA.name : String(fixture.teamAId),
        teamB: teamB ? teamB.name : String(fixture.teamBId),
        homeScore: h, awayScore: a, result,
        penalties: pen, penaltyHome: ph, penaltyAway: pa,
        scoreline: pen && ph != null && pa != null ? `${h}-${a} (${ph}-${pa} pens)` : `${h}-${a}`,
        predictionsScored: scored,
        settledAt: new Date(),
    } },
    { upsert: true }
  );

  return { fixtureId: String(fixtureId), result, homeScore: h, awayScore: a, predictionsScored: scored };
}

/** Reverse a settlement back to "scheduled" and clear awarded points. */
async function unsettleFixture(fixtureId) {
  await collections.fixtures().updateOne(
    { _id: fixtureId },
    { $set: { status: "scheduled" }, $unset: { homeScore: "", awayScore: "", result: "", penalties: "", penaltyHome: "", penaltyAway: "", settledAt: "" } }
  );
  await collections.predictions().updateMany(
    { fixtureId: String(fixtureId) },
    { $set: { scored: false }, $unset: { points: "", winPoints: "", scorePoints: "", winCorrect: "", exactCorrect: "", scoredAt: "" } }
  );
  await collections.settledScores().deleteOne({ fixtureId: String(fixtureId) });
  return { fixtureId: String(fixtureId), status: "scheduled" };
}

module.exports = { settleFixture, unsettleFixture };
