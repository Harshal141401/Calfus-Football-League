const test = require("node:test");
const assert = require("node:assert");
const { resultFromScore, scorePrediction } = require("../src/scoring");

test("resultFromScore is relative to Team A (home)", () => {
  assert.equal(resultFromScore(2, 1), "win");
  assert.equal(resultFromScore(1, 1), "draw");
  assert.equal(resultFromScore(0, 3), "lose");
});

test("outcome only: correct +3, wrong -1", () => {
  const f = { homeScore: 2, awayScore: 0 }; // result = win
  assert.equal(scorePrediction({ choice: "win" }, f).points, 3);
  assert.equal(scorePrediction({ choice: "draw" }, f).points, -1);
  assert.equal(scorePrediction({ choice: "lose" }, f).points, -1);
});

test("exact score given and correct: +3 + 5 = 8", () => {
  const f = { homeScore: 2, awayScore: 1 }; // win
  const s = scorePrediction({ choice: "win", scoreHome: 2, scoreAway: 1 }, f);
  assert.equal(s.exactCorrect, true);
  assert.equal(s.points, 8);
});

test("score given but wrong: outcome +3 - 2 = 1", () => {
  const f = { homeScore: 2, awayScore: 1 }; // win
  const s = scorePrediction({ choice: "win", scoreHome: 3, scoreAway: 0 }, f);
  assert.equal(s.exactCorrect, false);
  assert.equal(s.scorePoints, -2);
  assert.equal(s.points, 1);
});

test("score given but wrong AND outcome wrong: -1 - 2 = -3", () => {
  const f = { homeScore: 0, awayScore: 2 }; // lose
  const s = scorePrediction({ choice: "win", scoreHome: 1, scoreAway: 0 }, f);
  assert.equal(s.points, -3);
});

test("no score given: no effect from the score line", () => {
  const f = { homeScore: 2, awayScore: 1 };
  const s = scorePrediction({ choice: "win", scoreHome: null, scoreAway: null }, f);
  assert.equal(s.gaveScore, false);
  assert.equal(s.scorePoints, 0);
  assert.equal(s.points, 3);
});
