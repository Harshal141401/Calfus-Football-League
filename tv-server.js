/* =============================================================================
   Standalone TV / kiosk server — serves ONLY the auto-updating TV page.
   It holds no database and no API of its own: tv.html fetches its data
   cross-origin from the main app's public, read-only endpoints
   (see TV_API_BASE baked in at build time by scripts/build-tv.js).

   Run:   npm run build:tv && npm run start:tv
   Deploy: a separate Render web service (see render.yaml -> calfus-fifa-tv).
   ========================================================================== */
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4500;

// Local assets (logos used by the TV chrome) so they load same-origin & fast.
app.use("/assets", express.static(path.join(__dirname, "assets")));

// The TV page at both / and /tv for convenience.
const page = (_req, res) => res.sendFile(path.join(__dirname, "tv.html"));
app.get("/", page);
app.get("/tv", page);

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`TV kiosk on http://localhost:${PORT}`));
