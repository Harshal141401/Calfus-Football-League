const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseEvents } = require("../src/espn");
const { matchFixture } = require("../src/matchFixture");

const ESPN_SAMPLE = {
  events: [{
    id: "760461",
    date: "2026-06-23T17:00Z",
    status: { type: { state: "post", completed: true, name: "STATUS_FULL_TIME" }, displayClock: "90'+6'" },
    competitions: [{ competitors: [
      { homeAway: "home", score: "5", team: { abbreviation: "POR", displayName: "Portugal" } },
      { homeAway: "away", score: "0", team: { abbreviation: "UZB", displayName: "Uzbekistan" } },
    ] }],
  }],
};

test("parseEvents normalizes an ESPN event", () => {
  const [e] = parseEvents(ESPN_SAMPLE);
  assert.equal(e.espnId, "760461");
  assert.equal(e.completed, true);
  assert.equal(e.state, "post");
  assert.deepEqual([e.home.abbr, e.away.abbr], ["POR", "UZB"]);
  assert.equal(e.home.score, 5);
  assert.equal(e.away.score, 0);
});

test("parseEvents drops malformed events", () => {
  assert.equal(parseEvents({ events: [{ id: "1", competitions: [] }] }).length, 0);
});

const teamsById = {
  "10": { id: "10", abbr: "POR", name: "Portugal" },
  "20": { id: "20", abbr: "UZB", name: "Uzbekistan" },
};

test("matchFixture maps ESPN scores to fixture Team A / Team B by identity, not home/away", () => {
  const [ev] = parseEvents(ESPN_SAMPLE);
  // Fixture lists Uzbekistan as Team A even though ESPN has Portugal as home.
  const fixtures = [{ _id: "f1", teamAId: "20", teamBId: "10", kickoff: "2026-06-23T17:00:00Z" }];
  const m = matchFixture(ev, fixtures, teamsById);
  assert.equal(m.fixture._id, "f1");
  assert.equal(m.homeScore, 0); // Team A = Uzbekistan
  assert.equal(m.awayScore, 5); // Team B = Portugal
});

test("matchFixture requires same UTC day", () => {
  const [ev] = parseEvents(ESPN_SAMPLE);
  const fixtures = [{ _id: "f1", teamAId: "10", teamBId: "20", kickoff: "2026-06-24T17:00:00Z" }];
  assert.equal(matchFixture(ev, fixtures, teamsById), null);
});

test("matchFixture falls back to name when abbreviations differ", () => {
  const [ev] = parseEvents(ESPN_SAMPLE);
  const oddAbbr = {
    "10": { id: "10", abbr: "PRT", name: "Portugal" },
    "20": { id: "20", abbr: "UZ", name: "Uzbekistan" },
  };
  const fixtures = [{ _id: "f1", teamAId: "10", teamBId: "20", kickoff: "2026-06-23T00:00:00Z" }];
  const m = matchFixture(ev, fixtures, oddAbbr);
  assert.equal(m.fixture._id, "f1");
  assert.equal(m.homeScore, 5); // Team A = Portugal (home)
});
