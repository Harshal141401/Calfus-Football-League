const test = require("node:test");
const assert = require("node:assert");
const { parseLineup } = require("../src/espnLineups");

const SAMPLE = {
  rosters: [
    { homeAway: "home", roster: [
      { starter: true, jersey: "1", athlete: { displayName: "G. Keeper" }, position: { abbreviation: "G" } },
      { starter: true, jersey: "10", athlete: { displayName: "S. Striker" }, position: { abbreviation: "F" } },
      { starter: false, jersey: "23", athlete: { displayName: "B. Bench" }, position: { abbreviation: "M" } },
    ]},
    { homeAway: "away", roster: [
      { starter: true, jersey: "1", athlete: { displayName: "A. Goalie" } },
      { starter: false, jersey: "9", athlete: { displayName: "X. Sub" } },
    ]},
    { homeAway: "neutral", roster: [{ starter: true, athlete: { displayName: "Ignore Me" } }] },
  ],
};

test("parseLineup returns only starters per side", () => {
  const lu = parseLineup(SAMPLE);
  assert.equal(lu.home.length, 2);
  assert.equal(lu.away.length, 1);
  assert.deepEqual(lu.home[0], { id: "", num: "1", name: "G. Keeper", pos: "G" });
  assert.equal(lu.home[1].name, "S. Striker");
  assert.equal(lu.away[0].name, "A. Goalie");
});

test("parseLineup is safe on empty/missing data", () => {
  assert.deepEqual(parseLineup({}), { home: [], away: [] });
  assert.deepEqual(parseLineup(null), { home: [], away: [] });
  assert.deepEqual(parseLineup({ rosters: [{ homeAway: "home" }] }), { home: [], away: [] });
});
