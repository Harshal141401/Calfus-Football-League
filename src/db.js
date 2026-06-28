/* Single shared Mongo connection + collection accessors + index setup. */
const { MongoClient } = require("mongodb");
const config = require("./config");

const client = new MongoClient(config.MONGODB_URI);
let database = null;

async function connect() {
  if (database) return database;
  await client.connect();
  database = client.db(config.DB_NAME);

  // Indexes. One prediction per (employee, fixture); fast leaderboard + lookups.
  await database.collection("predictions").createIndex(
    { employeeId: 1, fixtureId: 1 }, { unique: true }
  );
  await database.collection("predictions").createIndex({ fixtureId: 1 });
  await database.collection("predictions").createIndex({ scored: 1 });
  await database.collection("fixtures").createIndex({ apiId: 1 }, { unique: true, sparse: true });
  await database.collection("fixtures").createIndex({ kickoff: 1 });
  // One settled-score record per fixture (the results ledger).
  await database.collection("settledScores").createIndex({ fixtureId: 1 }, { unique: true });
  // One password credential per email (login).
  await database.collection("credentials").createIndex({ email: 1 }, { unique: true });
  // Cache of ESPN athlete -> club name (keyed by athlete id; clubs are stable for the tournament).
  await database.collection("athleteClubs").createIndex({ at: 1 });
  // One tournament-winner pick per employee (the optional +25 champion bet).
  await database.collection("championPicks").createIndex({ employeeId: 1 }, { unique: true });

  console.log(`Connected to ${config.DB_NAME}`);
  return database;
}

const collections = {
  employees: () => database.collection(config.EMPLOYEES_COLLECTION),
  teams: () => database.collection("teams"),
  fixtures: () => database.collection("fixtures"),
  predictions: () => database.collection("predictions"),
  settledScores: () => database.collection("settledScores"),
  credentials: () => database.collection("credentials"),
  athleteClubs: () => database.collection("athleteClubs"),
  championPicks: () => database.collection("championPicks"),
  settings: () => database.collection("settings"),   // misc key/value (e.g. tournament champion)
};

module.exports = { connect, collections, client };
