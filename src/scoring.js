/* Pure scoring functions — no I/O, easy to reason about and test.
   Convention matches the dashboard: outcomes are relative to Team A (home).
     win  = Team A wins
     draw = draw
     lose = Team A loses (Team B wins) */
const { POINTS } = require("./config");

/** Final outcome from a scoreline (home = Team A). */
function resultFromScore(homeScore, awayScore) {
  if (homeScore > awayScore) return "win";
  if (homeScore < awayScore) return "lose";
  return "draw";
}

/** Outcome including a penalty shootout: a level regulation score is decided by
 *  the shootout (knockouts never end in a draw). Falls back to the scoreline. */
function resultWithPens(f) {
  if (f.penalties && f.penaltyHome != null && f.penaltyAway != null && f.penaltyHome !== f.penaltyAway) {
    return f.penaltyHome > f.penaltyAway ? "win" : "lose";
  }
  return resultFromScore(f.homeScore, f.awayScore);
}

/**
 * Score a single prediction against a settled fixture.
 * @param {{choice:string, scoreHome:?number, scoreAway:?number, penalty:?boolean}} pred
 * @param {{homeScore:number, awayScore:number, penalties:?boolean}} fixture
 * @returns {{result, winCorrect, winPoints, gaveScore, exactCorrect, scorePoints, points}}
 */
function scorePrediction(pred, fixture) {
  const result = resultWithPens(fixture);

  const winCorrect = pred.choice === result;
  const winPoints = winCorrect ? POINTS.WIN_CORRECT : POINTS.WIN_WRONG;

  const gaveScore = pred.scoreHome != null && pred.scoreAway != null;
  let exactCorrect = false;
  let scorePoints = 0;
  if (gaveScore) {
    exactCorrect = pred.scoreHome === fixture.homeScore && pred.scoreAway === fixture.awayScore;
    // Penalty hedge: if the player flagged penalties and the match was indeed decided
    // on penalties, a wrong scoreline isn't punished (no -2); an exact hit still scores.
    const forgive = !exactCorrect && pred.penalty && fixture.penalties;
    scorePoints = exactCorrect ? POINTS.SCORE_CORRECT : (forgive ? 0 : POINTS.SCORE_WRONG);
  }

  return {
    result,
    winCorrect,
    winPoints,
    gaveScore,
    exactCorrect,
    scorePoints,
    points: winPoints + scorePoints,
  };
}

module.exports = { resultFromScore, resultWithPens, scorePrediction };
