/* Trust-based auth: match Name + Email against the employees collection,
   then issue a signed JWT session. Admin actions use a separate header key. */
const jwt = require("jsonwebtoken");
const config = require("./config");
const { collections } = require("./db");

const norm = s => String(s || "").trim().toLowerCase();

/** Find an employee by email (case-insensitive) and verify the name matches. */
async function findEmployee(name, email) {
  const e = norm(email);
  if (!e) return null;
  // Employee docs use mixed field names (Email/email, Name/name/...). Match on email.
  const doc = await collections.employees().findOne({
    $or: [
      { Email: { $regex: `^${escapeRegex(e)}$`, $options: "i" } },
      { email: { $regex: `^${escapeRegex(e)}$`, $options: "i" } },
    ],
  });
  if (!doc) return null;

  const docName = doc.Name || doc.name || doc.fullName || doc.employeeName ||
    [doc.firstName, doc.lastName].filter(Boolean).join(" ");
  // Trust-based: require the email to exist; require name to match if one is stored.
  if (docName && norm(docName) !== norm(name)) return null;

  const location = doc.Location || doc.location || doc.office || "";
  return {
    id: String(doc._id),
    name: docName || name,
    email: doc.Email || doc.email,
    location,
    tz: config.officeTzFor(location),   // IST for India, US Pacific otherwise
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function issueToken(emp) {
  return jwt.sign(
    { sub: emp.id, name: emp.name, email: emp.email, loc: emp.location, tz: emp.tz },
    config.SESSION_SECRET,
    { expiresIn: `${config.SESSION_TTL_HOURS}h` }
  );
}

/** Express middleware: require a valid session token. Populates req.user. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing session token" });
  try {
    const payload = jwt.verify(token, config.SESSION_SECRET);
    req.user = {
      id: payload.sub, name: payload.name, email: payload.email,
      location: payload.loc || "",
      // Fall back to deriving tz if an older token predates the tz claim.
      tz: payload.tz || config.officeTzFor(payload.loc),
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

/** Mint an admin session token (role=admin), used by the browser admin login. */
function issueAdminToken() {
  return jwt.sign({ role: "admin" }, config.SESSION_SECRET, { expiresIn: `${config.SESSION_TTL_HOURS}h` });
}

/** Validate an admin password against ADMIN_PASSWORD (or ADMIN_KEY fallback). */
function checkAdminPassword(password) {
  const expected = config.ADMIN_PASSWORD || config.ADMIN_KEY;
  return !!expected && password === expected;
}

/** Express middleware: allow an admin-role JWT (Bearer) OR the static admin key header. */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.SESSION_SECRET);
      if (payload.role === "admin") { req.admin = true; return next(); }
    } catch { /* fall through to key check */ }
  }
  if (config.ADMIN_KEY && req.headers["x-admin-key"] === config.ADMIN_KEY) {
    req.admin = true; return next();
  }
  if (!config.ADMIN_PASSWORD && !config.ADMIN_KEY) {
    return res.status(503).json({ error: "Admin disabled — set ADMIN_PASSWORD or ADMIN_KEY in .env" });
  }
  return res.status(403).json({ error: "Admin authentication required" });
}

module.exports = { findEmployee, issueToken, requireAuth, requireAdmin, issueAdminToken, checkAdminPassword };
