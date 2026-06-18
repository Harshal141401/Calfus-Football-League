/* =============================================================================
   FIFA Predictor — backend API
   The dashboard (browser) cannot talk to MongoDB directly. This tiny server
   sits in the middle: it reads employees from your Atlas cluster with the
   official MongoDB driver, and (optionally) proxies the worldcup26.ir football
   API so the browser never hits a CORS wall or sees your credentials.

   Run:
     npm install
     cp .env.example .env      # then put your ROTATED Mongo URI in .env
     npm start
   ========================================================================== */
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const {
  MONGODB_URI,
  DB_NAME = "employeeDetails",          // db name you gave
  COLLECTION = "promptWars",            // collection name you gave
  PORT = 4000,
  WC_BASE = "https://worldcup26.ir",    // football API base
  WC_TOKEN = ""                          // football API JWT, if reads need auth
} = process.env;

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
  process.exit(1);
}

const app = express();
app.use(cors());                 // lets the dashboard call this from any origin
app.use(express.json());
app.use(express.static("public")); // drop fifa-prediction-dashboard.html in ./public

// ---- single shared Mongo connection ----------------------------------------
const client = new MongoClient(MONGODB_URI);
let coll = null;
async function db() {
  if (!coll) {
    await client.connect();
    coll = client.db(DB_NAME).collection(COLLECTION);
    console.log(`Connected to ${DB_NAME}.${COLLECTION}`);
  }
  return coll;
}

// ---- health -----------------------------------------------------------------
app.get("/api/health", async (_req, res) => {
  try { await (await db()).estimatedDocumentCount(); res.json({ status: "ok" }); }
  catch (e) { res.status(500).json({ status: "error", message: e.message }); }
});

// ---- INSPECT: run this ONCE to see what's actually in the collection --------
// Open http://localhost:4000/api/inspect — it shows a sample document so you
// can confirm the real field names, then tune mapEmployee() below.
// Remove or protect this route before any real deployment.
app.get("/api/inspect", async (_req, res) => {
  try {
    const c = await db();
    const count = await c.estimatedDocumentCount();
    const sample = await c.findOne({});
    res.json({ db: DB_NAME, collection: COLLECTION, count, sampleDocument: sample });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- map a raw Mongo document to what the dashboard expects -----------------
// The dashboard wants: { id, name }  (it adds an avatar colour itself).
// I don't know your exact field names, so this tries the common ones. After
// you've looked at /api/inspect, adjust the fallbacks below to match reality.
function mapEmployee(doc) {
  const id = String(doc._id ?? doc.id ?? doc.employeeId ?? doc.Email ?? doc.email ?? "");
  const joined = [doc.firstName, doc.lastName].filter(Boolean).join(" ");
  const name =
    doc.Name || doc.name || doc.fullName || doc.employeeName || doc.username ||
    joined || doc.Email || doc.email || "Unknown";
  return { id, name, email: doc.Email ?? doc.email ?? null };
}

// ---- EMPLOYEES: the endpoint the dashboard will call ------------------------
app.get("/api/employees", async (_req, res) => {
  try {
    const docs = await (await db()).find({}).toArray();
    res.json(docs.map(mapEmployee).filter(e => e.id && e.name));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- FOOTBALL API PROXY (optional) ------------------------------------------
// Browser calls e.g. /api/wc/get/games -> this forwards to worldcup26.ir,
// adding the token server-side. Fixes CORS and keeps the token off the client.
app.get("/api/wc/*", async (req, res) => {
  try {
    const path = req.params[0];
    const headers = WC_TOKEN ? { Authorization: "Bearer " + WC_TOKEN } : {};
    const r = await fetch(`${WC_BASE}/${path}`, { headers });
    const body = await r.text();
    res.status(r.status).type("application/json").send(body);
  } catch (e) { res.status(502).json({ error: "upstream fetch failed", message: e.message }); }
});

app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
