# Calfus Football League

A WC-2026 prediction game for employees. Pick the outcome of each fixture
(Team A win / draw / Team A lose) and optionally guess the exact scoreline.
Predictions are only accepted during scheduled windows (Mon & Thu by default);
an admin records final scores and the leaderboard updates from the points earned.

## Scoring

| Prediction | Correct | Wrong | Not given |
|---|---|---|---|
| Outcome (win/draw/lose) | **+3** | **−1** | n/a (required) |
| Exact scoreline (optional) | **+5** | **−2** | **0** (no effect) |

A fixture's points = outcome points + score-line points (e.g. right outcome +
exact score = **+8**; right outcome + wrong score = **+1**).

## Prediction window (time gating)

- Open only on configured weekdays (`PREDICTION_DAYS`, default **Mon & Thu**)
  within `[WINDOW_START, WINDOW_END)` in `WINDOW_TZ`.
- **Coverage horizon** (`COVERAGE_END_TIME`, default **06:00**): coverage runs until
  the next prediction day's early-morning cutoff — Monday shows matches up to Thursday
  06:00 IST; Thursday up to Monday 06:00 IST.
- A pick is editable only while the window is open **and** the match hasn't
  kicked off. From kickoff onward it is permanently locked.
- All timing is env-driven (the common US + IST slot is TBD) — change
  `WINDOW_TZ` / `WINDOW_START` / `WINDOW_END` without touching code.

## Setup

```bash
npm install
cp .env.example .env          # set MONGODB_URI, SESSION_SECRET, ADMIN_KEY
npm run seed                  # load 48 teams + 72 fixtures into Mongo (once)
npm start                     # http://localhost:4000
npm test                      # scoring unit tests
```

`npm run seed -- --reset-results` re-imports fixtures and clears any recorded
scores back to "scheduled". Plain `npm run seed` preserves settled results.

## Data model (MongoDB, db `employeeDetails`)

- **promptWars** (existing) — employees; login is validated against this.
- **teams** — 48 WC teams (id, name, abbr, flag).
- **fixtures** — `apiId, teamAId, teamBId, date, time, kickoff (absolute),
  round, group, md, status, result, homeScore, awayScore`.
- **predictions** — one per `(employeeId, fixtureId)` (unique index):
  `choice, scoreHome, scoreAway, scored, points, winCorrect, exactCorrect`.
- The **leaderboard** is aggregated live from scored predictions — the points
  written onto each prediction at settle time are the source of truth, so it
  never drifts and re-settling a fixture corrects the board automatically.

## API

Auth uses a Bearer session token from login. Admin routes need the
`X-Admin-Key` header.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{name,email}` → `{token,user}` (matched against employees) |
| POST | `/api/admin/login` | — | `{password}` → `{token}` (admin session; password = `ADMIN_PASSWORD` or `ADMIN_KEY`) |
| GET | `/api/auth/me` | session | current session user |
| GET | `/api/window` | — | `{open, opensAt, closesAt, coverageEnd, serverTime}` |
| GET | `/api/teams` | — | team list |
| GET | `/api/fixtures` | — | all fixtures + `predictable`/`locked` flags |
| POST | `/api/predictions` | session | `{fixtureId, choice, scoreHome?, scoreAway?}` (upsert, window-gated) |
| GET | `/api/predictions/me` | session | caller's predictions + awarded points |
| GET | `/api/leaderboard` | — | ranked standings |
| GET | `/api/employees` | — | employee directory |
| POST | `/api/admin/fixtures/:id/settle` | admin | `{homeScore, awayScore}` → score all predictions |
| POST | `/api/admin/fixtures/:id/unsettle` | admin | revert to scheduled, clear points |
| GET | `/api/admin/predictions/:fixtureId` | admin | everyone's picks for a fixture |
| GET | `/api/wc/*` | — | optional passthrough proxy to the football API |

## Settling results (admin)

**In the browser:** open the dashboard → **Admin** tab → enter the admin password
(`ADMIN_PASSWORD`, or `ADMIN_KEY` if that's blank) → type each final score and hit
**Settle**. Points are awarded immediately, and every open dashboard refreshes
within ~30s. Re-settling a corrected score is safe (no double-counting); **Clear**
reverts a result.

**Via curl** (automation):

```bash
curl -X POST localhost:4000/api/admin/fixtures/<FIXTURE_ID>/settle \
  -H "X-Admin-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"homeScore":2,"awayScore":1}'
```

## Layout

```
server.js              app wiring (employees, proxy, mounts routes)
scripts/seed.js        import teams + fixtures from the dashboard HTML
src/config.js          all env-driven config (window, scoring, auth)
src/db.js              Mongo connection + indexes
src/windows.js         timezone-aware window + coverage + lock logic
src/scoring.js         pure scoring functions
src/auth.js            login matching, JWT sessions, auth/admin middleware
src/settle.js          settlement (idempotent re-scoring)
src/routes/*.js        auth, fixtures, predictions, leaderboard, admin
test/scoring.test.js   scoring unit tests
```
