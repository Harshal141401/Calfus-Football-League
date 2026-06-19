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

/**
 * Score a single prediction against a settled fixture.
 * @param {{choice:string, scoreHome:?number, scoreAway:?number}} pred
 * @param {{homeScore:number, awayScore:number}} fixture
 * @returns {{result, winCorrect, winPoints, gaveScore, exactCorrect, scorePoints, points}}
 */
function scorePrediction(pred, fixture) {
  const result = resultFromScore(fixture.homeScore, fixture.awayScore);

  const winCorrect = pred.choice === result;
  const winPoints = winCorrect ? POINTS.WIN_CORRECT : POINTS.WIN_WRONG;

  const gaveScore = pred.scoreHome != null && pred.scoreAway != null;
  let exactCorrect = false;
  let scorePoints = 0;
  if (gaveScore) {
    exactCorrect = pred.scoreHome === fixture.homeScore && pred.scoreAway === fixture.awayScore;
    scorePoints = exactCorrect ? POINTS.SCORE_CORRECT : POINTS.SCORE_WRONG;
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

module.exports = { resultFromScore, scorePrediction };
