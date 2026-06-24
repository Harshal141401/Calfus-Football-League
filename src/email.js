/* Microsoft Graph email via client-credentials. No SDK — native fetch.
   Requires the app registration to have application permission Mail.Send (admin-consented)
   and GRAPH_SENDER to be a licensed mailbox the app may send as. */
const config = require("./config");

function isConfigured() {
  return Boolean(
    config.EMAIL_ENABLED &&
    config.GRAPH_TENANT_ID && config.GRAPH_CLIENT_ID &&
    config.GRAPH_CLIENT_SECRET && config.GRAPH_SENDER
  );
}

let cached = { token: null, expMs: 0 };

async function getToken() {
  if (cached.token && Date.now() < cached.expMs) return cached.token;
  const body = new URLSearchParams({
    client_id: config.GRAPH_CLIENT_ID,
    client_secret: config.GRAPH_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(
    `https://login.microsoftonline.com/${config.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
      signal: AbortSignal.timeout(10000) }
  );
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Graph token ${r.status}: ${j.error_description || j.error || "unknown"}`);
  cached = { token: j.access_token, expMs: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.token;
}

async function sendMail(to, subject, html) {
  if (!isConfigured()) { console.warn("[email] not configured — skipping send to", to); return false; }
  const token = await getToken();
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.GRAPH_SENDER)}/sendMail`,
    { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false,
      }),
      signal: AbortSignal.timeout(10000) }
  );
  if (!r.ok) throw new Error(`Graph sendMail ${r.status}: ${await r.text()}`);
  return true;
}

module.exports = { isConfigured, sendMail };
