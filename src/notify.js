/* Email everyone who predicted a just-settled fixture a personalized result.
   Reads fresh state (fixture is already settled, predictions already scored). */
const { collections } = require("./db");
const { sendMail, isConfigured } = require("./email");

async function notifyPredictors(fixtureId) {
  if (!isConfigured()) { console.warn("[notify] email disabled — skipping fixture", String(fixtureId)); return 0; }

  const fixtures = collections.fixtures();
  const fixture = await fixtures.findOne({ _id: fixtureId });
  if (!fixture || fixture.status !== "settled") return 0;

  const [teamA, teamB] = await Promise.all([
    collections.teams().findOne({ id: String(fixture.teamAId) }),
    collections.teams().findOne({ id: String(fixture.teamBId) }),
  ]);
  const nameA = teamA?.name || `Team ${fixture.teamAId}`;
  const nameB = teamB?.name || `Team ${fixture.teamBId}`;
  const preds = await collections.predictions().find({ fixtureId: String(fixtureId) }).toArray();

  let sent = 0;
  for (const p of preds) {
    if (!p.employeeEmail) continue;
    try {
      const html = buildEmail(p, fixture, nameA, nameB);
      await sendMail(p.employeeEmail, `Result: ${nameA} ${fixture.homeScore}–${fixture.awayScore} ${nameB}`, html);
      sent++;
    } catch (e) {
      console.error(`[notify] failed for ${p.employeeEmail}:`, e.message);
    }
  }
  console.log(`[notify] fixture ${String(fixtureId)}: emailed ${sent}/${preds.length} predictors`);
  return sent;
}

function outcomeText(result, nameA, nameB) {
  if (result === "win") return `${nameA} won`;
  if (result === "lose") return `${nameB} won`;
  return "It was a draw";
}
function pickText(choice, nameA, nameB) {
  if (choice === "win") return `${nameA} to win`;
  if (choice === "lose") return `${nameB} to win`;
  return "a Draw";
}

function buildEmail(p, fixture, nameA, nameB) {
  const finalLine = `${nameA} ${fixture.homeScore}–${fixture.awayScore} ${nameB}`;
  const gaveScore = p.scoreHome != null && p.scoreAway != null;
  const yourScore = gaveScore ? `${p.scoreHome}–${p.scoreAway}` : "—";
  const verdict = p.winCorrect ? "✅ Correct" : "❌ Wrong";
  const exact = gaveScore ? (p.exactCorrect ? " · exact score ✅" : " · score ❌") : "";
  const points = p.points ?? 0;
  const sign = points > 0 ? "+" : "";
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
    <h2 style="margin:0 0 4px">Full time: ${finalLine}</h2>
    <p style="color:#555;margin:0 0 16px">${fixture.round || ""} · ${outcomeText(fixture.result, nameA, nameB)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      <tr><td style="padding:6px 0;color:#555">Your pick</td><td style="padding:6px 0;text-align:right">${pickText(p.choice, nameA, nameB)}</td></tr>
      <tr><td style="padding:6px 0;color:#555">Your scoreline</td><td style="padding:6px 0;text-align:right">${yourScore}</td></tr>
      <tr><td style="padding:6px 0;color:#555">Outcome</td><td style="padding:6px 0;text-align:right">${verdict}${exact}</td></tr>
      <tr><td style="padding:10px 0;font-weight:bold;border-top:1px solid #eee">Points</td>
          <td style="padding:10px 0;text-align:right;font-weight:bold;border-top:1px solid #eee">${sign}${points}</td></tr>
    </table>
    <p style="color:#888;font-size:13px;margin-top:20px">Calfus Football League — check the leaderboard for your standing.</p>
  </div>`;
}

module.exports = { notifyPredictors };
