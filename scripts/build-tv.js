// Generates the standalone, login-free TV/kiosk page (tv.html, served at /tv)
// from the dashboard's TV-mode markup, CSS and JS. Re-run after changing TV mode:
//   node scripts/build-tv.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "fifa-prediction-dashboard.html"), "utf8");

// --- extract the single <style>…</style> ---
const css = src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));

// --- pull the dashboard's <head> font <link> tags verbatim, so the TV page uses
//     the exact same fonts as admin TV mode (no drift if they change later) ---
const head = src.slice(src.indexOf("<head>"), src.indexOf("</head>"));
const fontLinks = (head.match(/<link[^>]*(?:fonts\.googleapis|fonts\.gstatic)[^>]*>/g) || []).join("\n");

// --- extract the TV overlay markup (<div class="tv-overlay" …> … </div>) ---
const tvStart = src.indexOf('<div class="tv-overlay"');
// the overlay closes right before the toast block
const toastIdx = src.indexOf('<div class="toast"', tvStart);
const tvHTML = src.slice(tvStart, toastIdx).trim();

// --- extract the script body, minus the trailing init() call ---
let js = src.slice(src.indexOf("<script>") + 8, src.indexOf("</script>"));
// drop the final "init();" so the dashboard bootstrap doesn't run
js = js.replace(/\n\s*init\(\);\s*$/, "\n");

// Where the TV page reads its data from. When the TV page is deployed as its OWN
// service (separate URL, same backend), this points at the main app's public API.
// Override at build time:  TV_API_BASE=https://your-app.onrender.com npm run build:tv
// Empty string => same-origin (when tv.html is served by the main app itself).
const API_BASE = (process.env.TV_API_BASE || "https://calfus-football-league.onrender.com").replace(/\/$/, "");

const bootstrap = `
/* ===================== STANDALONE TV / KIOSK BOOTSTRAP ===================== *
 * Runs the exact TV-mode carousel with no login, against the public read-only
 * API. Re-fetches the board on a timer so the screen stays current.            */
  // Point all data reads at the main app's API (cross-origin when deployed apart).
  API.base = ${JSON.stringify(API_BASE)};
  // Route every data read through the public, auth-free endpoints. Reassigning the
  // hoisted apiJson binding intercepts the internal loadData()/refreshBoard() calls.
  const _origApiJson = apiJson;
  apiJson = async function(p, opts){
    if(p && p.indexOf("/api/") === 0 && p.indexOf("/api/public/") !== 0){
      p = p.replace("/api/", "/api/public/");   // /api/fixtures -> /api/public/fixtures, etc.
    }
    return _origApiJson(p, opts);
  };

  // A stand-in "user" so loadData()/state has the field it expects.
  currentUser = { id: "__tv__", name: "TV", email: "" };

  // The kiosk page is already full-bleed, so we render the overlay inline and run
  // the timers directly. bootTV() retries until the data loads (the free-tier API
  // may be cold-starting); once it succeeds it latches and never reverts to the
  // "Waiting" state, even if a slow earlier attempt resolves late.
  let _booted = false, _booting = false;
  async function bootTV(){
    if(_booted || _booting) return;
    _booting = true;
    try {
      await loadData();
    } catch(e){
      _booting = false;
      console.error("TV load failed, retrying…", e);
      if(!_booted){
        document.getElementById("tvStage").innerHTML =
          '<div class="tv-empty">Connecting to the league…</div>';
      }
      return setTimeout(bootTV, 4000);
    }
    try { await refreshWindow(); } catch(e){}
    _booted = true; _booting = false;

    const tv = document.getElementById("tv");
    tv.hidden = false;
    document.getElementById("tvBrand").innerHTML = renderBrand();
    const ts = document.getElementById("tvSparks"); if(ts) ts.innerHTML = sparkMarkup();

    tvScene = 0; pickWC(); renderTV(); buildTicker();
    document.getElementById("tvDots").innerHTML =
      TV_SCENES.map((_,i)=>'<i class="'+(i===0?"on":"")+'"></i>').join("");

    clearInterval(tvCycle);  tvCycle  = setInterval(()=>{ if(!tvPaused) nextScene(1); }, TV_INTERVAL);
    clearInterval(tvClockT); tvClockT = setInterval(tickTVClock, 1000); tickTVClock();
    clearInterval(tvCountdownT); tvCountdownT = setInterval(tickCountdown, 1000);
    // Auto-update the board so results/picks refresh on the big screen.
    clearInterval(tvRefresh); tvRefresh = setInterval(async ()=>{
      try { await refreshBoard(); } catch(e){}
      renderTV(); buildTicker();
    }, 60000);
  }

  // Allow manual advance on the kiosk: arrow keys, click, or swipe.
  function wireKiosk(){
    document.addEventListener("keydown", e=>{
      if(!_booted) return;
      if(e.key==="ArrowRight"||e.key===" ") nextScene(1);
      else if(e.key==="ArrowLeft") nextScene(-1);
    });
    document.getElementById("tvStage").addEventListener("click", ()=>{ if(_booted) nextScene(1); });
  }

  // Hide the exit button (nothing to exit to on a kiosk) and start.
  function start(){
    const x = document.getElementById("tvExit"); if(x) x.style.display = "none";
    try { buildSparks(); } catch(e){}                  // background sparks (same as the app)
    try { paintPitchLines(".bg-pitch"); } catch(e){}   // background pitch markings (same as the app)
    wireKiosk();
    bootTV();
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
`;

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Calfus FIFA League — TV</title>
${fontLinks}
<style>${css}
/* kiosk: the overlay IS the page */
html,body{margin:0;height:100%;background:#0B0F14;overflow:hidden}
.tv-overlay{position:fixed;inset:0}
</style>
</head>
<body>
<div class="bg-pitch"></div>
<div class="bg-lights"></div>
<div class="sparks" id="sparks" aria-hidden="true"></div>
<div class="bg-vignette"></div>

${tvHTML}

<div class="toast" id="toast"><span class="ic">✓</span><span id="toastMsg"></span></div>

<script>
${js}
${bootstrap}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "tv.html"), out);
console.log("Wrote tv.html  (" + out.length + " bytes)");
