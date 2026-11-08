require("dotenv").config();
const express = require("express");
const http = require("http");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const SECRET = process.env.JWT_SECRET;
if (!SECRET || Buffer.byteLength(SECRET) < 32) throw new Error("JWT_SECRET must contain at least 32 random bytes.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const capacitorOrigins = [
  "capacitor://localhost",
  "ionic://localhost",
  "https://localhost",
  "http://localhost",
  "https://pinglet-chat-live.onrender.com"
];
const io = new Server(server, { cors: { origin: capacitorOrigins } });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false }, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
const PORT = process.env.PORT || 3000;
const TURN_URLS = (process.env.TURN_URLS || "").split(",").map(value => value.trim()).filter(Boolean);
const TURN_SHARED_SECRET = process.env.TURN_SHARED_SECRET || "";
const TURN_CREDENTIAL_TTL_SECONDS = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS || 3600);
const TURN_CONFIGURED =
  TURN_URLS.length > 0 &&
  TURN_URLS.length <= 8 &&
  TURN_URLS.every(value => /^turns?:/i.test(value) && value.length <= 512 && !/\\s/.test(value)) &&
  Buffer.byteLength(TURN_SHARED_SECRET) >= 32 &&
  Number.isInteger(TURN_CREDENTIAL_TTL_SECONDS) &&
  TURN_CREDENTIAL_TTL_SECONDS >= 300 &&
  TURN_CREDENTIAL_TTL_SECONDS <= 86400;

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && capacitorOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Requested-With");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], mediaSrc: ["'self'", "blob:"], styleSrc: ["'self'", "'unsafe-inline'"],
  connectSrc: ["'self'", "https://pinglet-chat-live.onrender.com", "wss://pinglet-chat-live.onrender.com", "ws:", "wss:"], imgSrc: ["'self'", "data:"],
  objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
} } }));
app.use(express.json({ limit: "80kb" }));
app.use("/api", rateLimit({ windowMs: 60000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });
const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY, name VARCHAR(24) NOT NULL, code VARCHAR(14) UNIQUE NOT NULL,
      password TEXT NOT NULL, pubkey JSONB NOT NULL, terms_accepted_at TIMESTAMPTZ,
      created TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY, conversation TEXT NOT NULL,
      sender UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL, iv TEXT NOT NULL, created TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS msg_pair ON messages(conversation, created);
    CREATE INDEX IF NOT EXISTS msg_pair_cursor ON messages(conversation, created DESC, id DESC);
    CREATE TABLE IF NOT EXISTS friend_requests (
      id UUID PRIMARY KEY, sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
      created TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(sender_id, receiver_id), CHECK(sender_id <> receiver_id)
    );
    CREATE INDEX IF NOT EXISTS friend_requests_receiver_status ON friend_requests(receiver_id, status, created DESC);
    CREATE TABLE IF NOT EXISTS friendships (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label VARCHAR(32) NOT NULL DEFAULT 'Friend', created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, friend_id), CHECK(user_id <> friend_id)
    );
    CREATE INDEX IF NOT EXISTS friendships_friend_idx ON friendships(friend_id);
    CREATE TABLE IF NOT EXISTS blocked_users (
      blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(blocker_id, blocked_id), CHECK(blocker_id <> blocked_id)
    );
    CREATE INDEX IF NOT EXISTS blocked_users_blocked_idx ON blocked_users(blocked_id);
    CREATE TABLE IF NOT EXISTS reports (
      id UUID PRIMARY KEY,
      reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
      reported_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      category VARCHAR(32) NOT NULL CHECK (category IN ('harassment','sexual_exploitation','threats','spam','impersonation','other')),
      details TEXT NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','actioned','dismissed')),
      moderation_notes TEXT,
      created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS reports_status_created_idx ON reports(status, created DESC);
  `);
}
const friendCode = () => crypto.randomBytes(7).toString("hex").toUpperCase();
const tokenFor = (user) => jwt.sign({ id: user.id }, SECRET, { expiresIn: "12h", issuer: "pinglet", audience: "pinglet-web" });
function auth(req, res, next) {
  try {
    req.user = jwt.verify((req.headers.authorization || "").replace(/^Bearer /, ""), SECRET, { issuer: "pinglet", audience: "pinglet-web" });
    next();
  } catch { res.status(401).json({ error: "Please sign in again." }); }
}
async function termsRequired(req, res, next) {
  try {
    const result = await pool.query("SELECT terms_accepted_at IS NOT NULL AS accepted FROM users WHERE id=$1", [req.user.id]);
    if (!result.rowCount) return res.status(401).json({ error: "Please sign in again." });
    if (!result.rows[0].accepted) return res.status(428).json({ error: "Please review and accept the Terms of Use before using this feature." });
    next();
  } catch (error) { next(error); }
}
function validPubkey(key) {
  return !!key && key.kty === "EC" && key.crv === "P-256" && typeof key.x === "string" && typeof key.y === "string";
}
function validBase64(value) {
  return typeof value === "string" && value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
function inviteOrigin(req) {
  return (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || (req.protocol + "://" + req.get("host"))).replace(/\/$/, "");
}
async function areFriends(a, b) {
  const result = await pool.query("SELECT 1 FROM friendships WHERE user_id=$1 AND friend_id=$2", [a, b]);
  return result.rowCount > 0;
}
async function areBlockedEither(a, b) {
  const result = await pool.query("SELECT 1 FROM blocked_users WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1", [a, b]);
  return result.rowCount > 0;
}
function validUserId(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
const labelOptions = ["Friend", "True Friend", "Bestie", "Love", "Partner in Crime", "My Person"];

app.get("/health", async (req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true, service: "pinglet-chat", database: "connected" }); }
  catch { res.status(503).json({ ok: false, database: "unavailable" }); }
});

app.get("/api/calls/ice-servers", auth, termsRequired, (req, res) => {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  if (TURN_CONFIGURED) {
    const expiresAt = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
    const username = expiresAt + ":" + req.user.id;
    const credential = crypto.createHmac("sha1", TURN_SHARED_SECRET).update(username).digest("base64");
    iceServers.push({ urls: TURN_URLS, username, credential });
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ iceServers, turnConfigured: TURN_CONFIGURED });
});
app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const password = req.body.password, pubkey = req.body.pubkey;
    if (!name || name.length > 24 || typeof password !== "string" || password.length < 8 || password.length > 128 || !validPubkey(pubkey) || req.body.termsAccepted !== true) {
      return res.status(400).json({ error: "Enter a name, a valid public key, an 8–128 character password, and accept the Terms of Use." });
    }
    let code;
    do { code = friendCode(); } while ((await pool.query("SELECT 1 FROM users WHERE code=$1", [code])).rowCount);
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO users(id,name,code,password,pubkey,terms_accepted_at) VALUES($1,$2,$3,$4,$5::jsonb,NOW())", [id, name, code, await bcrypt.hash(password, 12), JSON.stringify(pubkey)]);
    meNameCache.set(id, name);
    const user = { id, name, code, pubkey };
    res.json({ token: tokenFor(user), user });
  } catch (error) {
    console.error("Registration failed:", error.message);
    res.status(500).json({ error: "Could not create your account." });
  }
});
app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const code = typeof req.body.code === "string" ? req.body.code.toUpperCase() : "";
    const result = await pool.query("SELECT * FROM users WHERE code=$1", [code]);
    const user = result.rows[0];
    if (!user || typeof req.body.password !== "string" || !await bcrypt.compare(req.body.password, user.password)) {
      return res.status(401).json({ error: "Friend code or password is incorrect." });
    }
    res.json({ token: tokenFor(user), user: { id: user.id, name: user.name, code: user.code, pubkey: user.pubkey } });
  } catch { res.status(400).json({ error: "Invalid sign-in request." }); }
});
app.get("/api/me", auth, async (req, res) => {
  const result = await pool.query("SELECT id,name,code,pubkey,(terms_accepted_at IS NOT NULL) AS \"termsAccepted\" FROM users WHERE id=$1", [req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Account not found." });
  res.json({ user: result.rows[0] });
});
app.post("/api/me/terms", auth, async (req, res) => {
  if (req.body.accepted !== true) return res.status(400).json({ error: "Please confirm that you accept the Terms of Use." });
  await pool.query("UPDATE users SET terms_accepted_at=COALESCE(terms_accepted_at,NOW()) WHERE id=$1", [req.user.id]);
  res.json({ accepted: true });
});
app.delete("/api/me", auth, authLimiter, async (req, res) => {
  const password = req.body && req.body.password;
  if (typeof password !== "string" || password.length > 128) return res.status(400).json({ error: "Enter your password to confirm account deletion." });
  const found = await pool.query("SELECT password FROM users WHERE id=$1", [req.user.id]);
  if (!found.rowCount) return res.status(404).json({ error: "Account not found." });
  if (!await bcrypt.compare(password, found.rows[0].password)) return res.status(401).json({ error: "Password is incorrect. Your account was not deleted." });
  await pool.query("DELETE FROM users WHERE id=$1", [req.user.id]);
  meNameCache.delete(req.user.id);
  io.in(req.user.id).disconnectSockets(true);
  res.json({ deleted: true });
});
app.get("/api/me/invite-qr", auth, async (req, res) => {
  const result = await pool.query("SELECT code FROM users WHERE id=$1", [req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Account not found." });
  const url = inviteOrigin(req) + "/invite/" + result.rows[0].code;
  const qr = await QRCode.toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: "M", color: { dark: "#111827", light: "#FFFFFF" } });
  res.json({ url, qr });
});
app.get("/api/lookup/:code", auth, lookupLimiter, async (req, res) => {
  const result = await pool.query("SELECT id,name,code,pubkey FROM users WHERE code=$1", [String(req.params.code).toUpperCase()]);
  if (!result.rowCount) return res.status(404).json({ error: "No account uses that friend code." });
  res.json({ user: result.rows[0] });
});
app.get("/api/friends", auth, async (req, res) => {
  const result = await pool.query(`SELECT u.id,u.name,u.code,u.pubkey,f.label,f.created
    FROM friendships f JOIN users u ON u.id=f.friend_id
    WHERE f.user_id=$1 ORDER BY lower(u.name), f.created`, [req.user.id]);
  res.json({ friends: result.rows });
});
app.get("/api/friend-requests", auth, async (req, res) => {
  const [incoming, outgoing] = await Promise.all([
    pool.query(`SELECT r.id,r.created,u.id AS user_id,u.name,u.code FROM friend_requests r
      JOIN users u ON u.id=r.sender_id WHERE r.receiver_id=$1 AND r.status='pending' ORDER BY r.created DESC`, [req.user.id]),
    pool.query(`SELECT r.id,r.created,u.id AS user_id,u.name,u.code FROM friend_requests r
      JOIN users u ON u.id=r.receiver_id WHERE r.sender_id=$1 AND r.status='pending' ORDER BY r.created DESC`, [req.user.id])
  ]);
  res.json({ incoming: incoming.rows, outgoing: outgoing.rows });
});
app.post("/api/friend-requests", auth, termsRequired, async (req, res) => {
  const code = typeof req.body.code === "string" ? req.body.code.trim().toUpperCase() : "";
  if (!code) return res.status(400).json({ error: "Enter a friend code." });
  const found = await pool.query("SELECT id,name,code FROM users WHERE code=$1", [code]);
  const target = found.rows[0];
  if (!target) return res.status(404).json({ error: "No account uses that friend code." });
  if (target.id === req.user.id) return res.status(400).json({ error: "That's your own friend code." });
  if (await areBlockedEither(req.user.id, target.id)) return res.status(403).json({ error: "This connection is unavailable." });
  if (await areFriends(req.user.id, target.id)) return res.json({ status: "friends", friend: target });
  const reverse = await pool.query("SELECT id FROM friend_requests WHERE sender_id=$1 AND receiver_id=$2 AND status='pending'", [target.id, req.user.id]);
  if (reverse.rowCount) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO friendships(user_id,friend_id) VALUES($1,$2),($2,$1) ON CONFLICT DO NOTHING", [req.user.id, target.id]);
      await client.query("UPDATE friend_requests SET status='accepted' WHERE id=$1", [reverse.rows[0].id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    io.to(target.id).emit("friendship", { id: req.user.id });
    io.to(req.user.id).emit("friendship", { id: target.id });
    return res.json({ status: "friends", friend: target });
  }
  const previous = await pool.query("SELECT id,status FROM friend_requests WHERE sender_id=$1 AND receiver_id=$2", [req.user.id, target.id]);
  let request;
  if (previous.rowCount) {
    request = await pool.query("UPDATE friend_requests SET status='pending',created=NOW() WHERE id=$1 RETURNING id,status,created", [previous.rows[0].id]);
  } else {
    request = await pool.query("INSERT INTO friend_requests(id,sender_id,receiver_id) VALUES($1,$2,$3) RETURNING id,status,created", [crypto.randomUUID(), req.user.id, target.id]);
  }
  io.to(target.id).emit("friend-request", { id: request.rows[0].id });
  res.json({ status: "pending", request: request.rows[0], friend: target });
});
app.post("/api/friend-requests/:id/accept", auth, termsRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT id,sender_id FROM friend_requests WHERE id=$1 AND receiver_id=$2 AND status='pending' FOR UPDATE", [req.params.id, req.user.id]);
    if (!found.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Friend request not found." }); }
    const request = found.rows[0];
    if (await areBlockedEither(req.user.id, request.sender_id)) { await client.query("ROLLBACK"); return res.status(403).json({ error: "This connection is unavailable." }); }
    await client.query("INSERT INTO friendships(user_id,friend_id) VALUES($1,$2),($2,$1) ON CONFLICT DO NOTHING", [req.user.id, request.sender_id]);
    await client.query("UPDATE friend_requests SET status='accepted' WHERE id=$1", [request.id]);
    await client.query("COMMIT");
    io.to(request.sender_id).emit("friendship", { id: req.user.id });
    io.to(req.user.id).emit("friendship", { id: request.sender_id });
    res.json({ status: "friends" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Accept request failed:", error.message);
    res.status(500).json({ error: "Could not accept request." });
  } finally { client.release(); }
});
app.post("/api/friend-requests/:id/decline", auth, async (req, res) => {
  const result = await pool.query("UPDATE friend_requests SET status='declined' WHERE id=$1 AND receiver_id=$2 AND status='pending' RETURNING id", [req.params.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Friend request not found." });
  res.json({ status: "declined" });
});
app.patch("/api/friends/:id/label", auth, termsRequired, async (req, res) => {
  const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
  if (!labelOptions.includes(label)) return res.status(400).json({ error: "Choose a label from the list." });
  const result = await pool.query("UPDATE friendships SET label=$1 WHERE user_id=$2 AND friend_id=$3 RETURNING label", [label, req.user.id, req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Saved friend not found." });
  res.json({ label });
});

/* In-app user safety: blocking, reporting and a protected moderation inbox. */
app.get("/api/blocks", auth, async (req, res) => {
  const result = await pool.query("SELECT u.id,u.name,b.created FROM blocked_users b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created DESC", [req.user.id]);
  res.json({ blocked: result.rows });
});
app.post("/api/users/:id/block", auth, lookupLimiter, async (req, res) => {
  const blockedId = req.params.id;
  if (!validUserId(blockedId)) return res.status(400).json({ error: "Invalid account." });
  if (blockedId === req.user.id) return res.status(400).json({ error: "You cannot block your own account." });
  const exists = await pool.query("SELECT 1 FROM users WHERE id=$1", [blockedId]);
  if (!exists.rowCount) return res.status(404).json({ error: "Account not found." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO blocked_users(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user.id, blockedId]);
    await client.query("DELETE FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)", [req.user.id, blockedId]);
    await client.query("UPDATE friend_requests SET status='declined' WHERE status='pending' AND ((sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1))", [req.user.id, blockedId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  removeBlockedPairFromCalls(req.user.id, blockedId);
  removeBlockedPairFromSnakeGames(req.user.id, blockedId);
  io.to(blockedId).emit("blocked", { by: req.user.id });
  res.json({ blocked: true });
});
app.delete("/api/users/:id/block", auth, lookupLimiter, async (req, res) => {
  if (!validUserId(req.params.id)) return res.status(400).json({ error: "Invalid account." });
  await pool.query("DELETE FROM blocked_users WHERE blocker_id=$1 AND blocked_id=$2", [req.user.id, req.params.id]);
  res.json({ blocked: false });
});
app.post("/api/reports", auth, lookupLimiter, async (req, res) => {
  const { reportedUserId, category, details } = req.body || {};
  const allowed = ["harassment", "sexual_exploitation", "threats", "spam", "impersonation", "other"];
  if (!validUserId(reportedUserId) || reportedUserId === req.user.id || !allowed.includes(category) || typeof details !== "string" || details.trim().length < 5 || details.length > 3000) {
    return res.status(400).json({ error: "Choose a reason and add at least a few details (up to 3,000 characters)." });
  }
  const exists = await pool.query("SELECT 1 FROM users WHERE id=$1", [reportedUserId]);
  if (!exists.rowCount) return res.status(404).json({ error: "Account not found." });
  const report = await pool.query("INSERT INTO reports(id,reporter_id,reported_user_id,category,details) VALUES($1,$2,$3,$4,$5) RETURNING id,created", [crypto.randomUUID(), req.user.id, reportedUserId, category, details.trim()]);
  res.status(201).json({ submitted: true, reportId: report.rows[0].id, created: report.rows[0].created });
});
function moderationAuth(req, res, next) {
  const expected = process.env.REPORTS_ADMIN_TOKEN || "";
  const supplied = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (Buffer.byteLength(expected) < 32) return res.status(503).json({ error: "The moderation inbox is not configured by the service operator." });
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Unauthorized." });
  next();
}
app.get("/api/moderation/reports", moderationAuth, async (req, res) => {
  const status = ["pending", "reviewing", "actioned", "dismissed"].includes(req.query.status) ? req.query.status : "pending";
  const result = await pool.query("SELECT id,reporter_id,reported_user_id,category,details,status,moderation_notes,created,reviewed FROM reports WHERE status=$1 ORDER BY created ASC LIMIT 100", [status]);
  res.json({ reports: result.rows });
});
app.patch("/api/moderation/reports/:id", moderationAuth, async (req, res) => {
  const { status, notes } = req.body || {};
  if (!["reviewing", "actioned", "dismissed"].includes(status) || (notes !== undefined && (typeof notes !== "string" || notes.length > 2000))) return res.status(400).json({ error: "Invalid moderation update." });
  const result = await pool.query("UPDATE reports SET status=$1,moderation_notes=$2,reviewed=NOW() WHERE id=$3 RETURNING id,status,reviewed", [status, notes || null, req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Report not found." });
  res.json({ report: result.rows[0] });
});
app.get("/api/messages/:peer", auth, async (req, res) => {
  const peer = req.params.peer;
  if (!await areFriends(req.user.id, peer)) return res.status(403).json({ error: "Add this person as a friend before chatting." });

  const conversation = [req.user.id, peer].sort().join(":");
  const pageSize = 100;
  let cursor = null;

  if (req.query.before !== undefined) {
    const encoded = req.query.before;
    if (typeof encoded !== "string" || encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
      return res.status(400).json({ error: "Invalid message-history cursor." });
    }
    try {
      const decoded = Buffer.from(encoded, "base64url");
      if (decoded.toString("base64url") !== encoded) return res.status(400).json({ error: "Invalid message-history cursor." });
      cursor = JSON.parse(decoded.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid message-history cursor." });
    }

    const validCursor = cursor && typeof cursor === "object" && !Array.isArray(cursor) &&
      typeof cursor.created === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.created) &&
      !Number.isNaN(Date.parse(cursor.created)) &&
      typeof cursor.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.id);
    if (!validCursor) return res.status(400).json({ error: "Invalid message-history cursor." });
  }

  const cursorClause = cursor ? " AND (created,id) < ($2::timestamptz,$3::uuid)" : "";
  const values = cursor ? [conversation, cursor.created, cursor.id] : [conversation];
  const result = await pool.query(
    `SELECT id,sender,recipient,ciphertext,iv,
       to_char(created AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created
     FROM messages
     WHERE conversation=$1${cursorClause}
     ORDER BY created DESC,id DESC
     LIMIT ${pageSize + 1}`,
    values
  );

  const hasMore = result.rows.length > pageSize;
  const page = result.rows.slice(0, pageSize);
  const oldest = page[page.length - 1];
  const nextCursor = hasMore && oldest
    ? Buffer.from(JSON.stringify({ created: oldest.created, id: oldest.id })).toString("base64url")
    : null;
  const messages = page.reverse();
  res.json({ messages, hasMore, nextCursor });
});
app.post("/api/messages", auth, termsRequired, async (req, res) => {
  const { recipient, ciphertext, iv } = req.body;
  if (typeof recipient !== "string" || !recipient || !validBase64(ciphertext) || ciphertext.length > 60000 || !validBase64(iv) || Buffer.from(iv, "base64").length !== 12) {
    return res.status(400).json({ error: "Invalid encrypted message." });
  }
  if (!await areFriends(req.user.id, recipient)) return res.status(403).json({ error: "You can only message saved friends." });
  const id = crypto.randomUUID(), conversation = [req.user.id, recipient].sort().join(":");
  const result = await pool.query("INSERT INTO messages(id,conversation,sender,recipient,ciphertext,iv) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,sender,recipient,ciphertext,iv,created", [id, conversation, req.user.id, recipient, ciphertext, iv]);
  io.to(recipient).emit("message", result.rows[0]);
  res.json({ message: result.rows[0] });
});

/* Server-authoritative two-player Snake Duel */
const snakeRooms = new Map();
const snakeWidth = 24, snakeHeight = 16, snakeTickMs = 150;
const opposite = { up: "down", down: "up", left: "right", right: "left" };
function snakeRoomKey(a,b) { return [a,b].sort().join(":"); }
function removeBlockedPairFromSnakeGames(firstUserId, secondUserId) {
  for (const [key, game] of snakeRooms) {
    if (!game.ids.includes(firstUserId) || !game.ids.includes(secondUserId)) continue;
    if (game.timer) clearInterval(game.timer);
    game.timer = null;
    game.status = "finished";
    game.winner = null;
    io.to(key).emit("snake:error", { message: "This game ended because one player blocked the other." });
    snakeRooms.delete(key);
  }
}
function newSnakeGame(roomKey, ids) {
  return {
    key: roomKey, ids: [...ids], sockets: new Map(), snakes: [
      { id: ids[0], body: [{x:4,y:7},{x:3,y:7},{x:2,y:7}], direction:"right", nextDirection:"right", score:0 },
      { id: ids[1], body: [{x:19,y:8},{x:20,y:8},{x:21,y:8}], direction:"left", nextDirection:"left", score:0 }
    ],
    food: {x:11,y:7}, status:"waiting", winner:null, timer:null, tick:0
  };
}
function placeFood(game) {
  const occupied = new Set(game.snakes.flatMap(s => s.body.map(p => p.x + "," + p.y)));
  const free = [];
  for (let y=0;y<snakeHeight;y++) for (let x=0;x<snakeWidth;x++) if (!occupied.has(x + "," + y)) free.push({x,y});
  game.food = free.length ? free[Math.floor(Math.random()*free.length)] : null;
}
function gameSnapshot(game) {
  return { width:snakeWidth,height:snakeHeight,status:game.status,winner:game.winner,food:game.food,
    players:game.snakes.map(s => ({id:s.id,body:s.body,direction:s.direction,score:s.score})) };
}
function broadcastSnake(game) { io.to(game.key).emit("snake:state", gameSnapshot(game)); }
function startSnakeGame(game) {
  if (game.timer) clearInterval(game.timer);
  game.status = "playing"; game.winner = null; game.tick = 0;
  game.snakes = game.ids.map((id,index) => index === 0
    ? {id,body:[{x:4,y:7},{x:3,y:7},{x:2,y:7}],direction:"right",nextDirection:"right",score:0}
    : {id,body:[{x:19,y:8},{x:20,y:8},{x:21,y:8}],direction:"left",nextDirection:"left",score:0});
  placeFood(game); broadcastSnake(game);
  game.timer = setInterval(() => {
    if (game.status !== "playing") return;
    game.tick++;
    const oldHeads = game.snakes.map(s => s.body[0]);
    const moves = game.snakes.map(s => {
      s.direction = s.nextDirection;
      const h = s.body[0];
      const d = s.direction;
      return { x:h.x + (d==="right"?1:d==="left"?-1:0), y:h.y + (d==="down"?1:d==="up"?-1:0) };
    });
    const occupied = game.snakes.map(s => s.body.slice(0,-1));
    let dead = [];
    game.snakes.forEach((snake,i) => {
      const head = moves[i];
      if (head.x<0 || head.y<0 || head.x>=snakeWidth || head.y>=snakeHeight) dead.push(snake.id);
      const hitsSelf = snake.body.slice(0,-1).some(p=>p.x===head.x&&p.y===head.y);
      const hitsOther = occupied[1-i].some(p=>p.x===head.x&&p.y===head.y);
      if (hitsSelf || hitsOther) dead.push(snake.id);
    });
    if (moves[0].x===moves[1].x && moves[0].y===moves[1].y) dead.push(game.snakes[0].id,game.snakes[1].id);
    if (moves[0].x===oldHeads[1].x && moves[0].y===oldHeads[1].y && moves[1].x===oldHeads[0].x && moves[1].y===oldHeads[0].y) dead.push(game.snakes[0].id,game.snakes[1].id);
    if (dead.length) {
      game.status="finished";
      const unique=[...new Set(dead)];
      game.winner=unique.length===2 ? "draw" : game.snakes.find(s=>s.id!==unique[0]).id;
      clearInterval(game.timer); game.timer=null; broadcastSnake(game); return;
    }
    game.snakes.forEach((snake,i) => {
      snake.body.unshift(moves[i]);
      if (game.food && moves[i].x===game.food.x && moves[i].y===game.food.y) { snake.score++; placeFood(game); }
      else snake.body.pop();
    });
    broadcastSnake(game);
  }, snakeTickMs);
}
/* Private four-digit audio/video rooms. Signaling is relayed; media stays peer-to-peer. */
const callRooms = new Map();
const callJoinAttempts = new Map();
const callRoomName = code => "call:" + code;
const callRoomCapacity = 4;
function leaveCallRoom(socket, notify = true) {
  const code = socket.data.callRoomCode;
  if (!code) return;
  socket.data.callRoomCode = null;
  socket.leave(callRoomName(code));
  const room = callRooms.get(code);
  if (!room) return;
  room.participants.delete(socket.id);
  if (notify) io.to(callRoomName(code)).emit("call:participant-left", { peerId: socket.id });
  if (!room.participants.size) callRooms.delete(code);
}
function removeBlockedPairFromCalls(firstUserId, secondUserId) {
  for (const room of callRooms.values()) {
    const pair = [...room.participants.entries()].filter(([, person]) => person.userId === firstUserId || person.userId === secondUserId);
    if (pair.length < 2) continue;
    for (const [socketId] of pair) {
      const client = io.sockets.sockets.get(socketId);
      if (client) leaveCallRoom(client);
    }
  }
}
io.use(async (socket,next) => {
  try {
    const user = jwt.verify(socket.handshake.auth.token,SECRET,{issuer:"pinglet",audience:"pinglet-web"});
    const result = await pool.query("SELECT terms_accepted_at IS NOT NULL AS accepted FROM users WHERE id=$1", [user.id]);
    if (!result.rowCount || !result.rows[0].accepted) return next(new Error("Please accept Pinglet's Terms first."));
    socket.user = user;
    next();
  } catch { next(new Error("Unauthorized")); }
});
io.on("connection", socket => {
  const userId=socket.user.id;
  socket.join(userId);

  socket.on("call:create", ({ mode } = {}, reply) => {
    const respond = typeof reply === "function" ? reply : () => {};
    if (socket.data.callRoomCode) return respond({ ok: false, error: "Leave your current call before creating another room." });
    if (mode !== "video" && mode !== "voice") return respond({ ok: false, error: "Choose a video or voice room." });
    let code;
    do { code = String(crypto.randomInt(0, 10000)).padStart(4, "0"); } while (callRooms.has(code));
    const room = { code, mode, participants: new Map() };
    room.participants.set(socket.id, { userId, name: meNameCache.get(userId) || "A Pinglet friend" });
    callRooms.set(code, room);
    socket.data.callRoomCode = code;
    socket.join(callRoomName(code));
    respond({ ok: true, code, mode, participants: [] });
  });

  socket.on("call:join", async ({ code } = {}, reply) => {
    const respond = typeof reply === "function" ? reply : () => {};
    const now = Date.now();
    let attempts = callJoinAttempts.get(userId);
    if (!attempts || attempts.resetAt <= now) {
      attempts = { count: 0, resetAt: now + 60_000 };
      callJoinAttempts.set(userId, attempts);
    }
    if (attempts.count >= 8) return respond({ ok: false, error: "Too many room-code attempts. Please wait a minute and try again." });
    attempts.count++;
    const roomCode = typeof code === "string" ? code.trim() : "";
    if (!/^\d{4}$/.test(roomCode)) return respond({ ok: false, error: "Enter the four-digit room code." });
    if (socket.data.callRoomCode) return respond({ ok: false, error: "Leave your current call before joining another room." });
    const room = callRooms.get(roomCode);
    if (!room) return respond({ ok: false, error: "That room code is unavailable. Check the code or create a new room." });
    for (const participant of room.participants.values()) {
      if (await areBlockedEither(userId, participant.userId) || !await areFriends(userId, participant.userId)) {
        return respond({ ok: false, error: "Call rooms are for saved friends. Add the host as a friend first." });
      }
    }
    if (room.participants.size >= callRoomCapacity) return respond({ ok: false, error: "This room is full (4 people maximum)." });
    const existing = [...room.participants.entries()].map(([peerId, person]) => ({ peerId, userId: person.userId, name: person.name }));
    room.participants.set(socket.id, { userId, name: meNameCache.get(userId) || "A Pinglet friend" });
    socket.data.callRoomCode = roomCode;
    socket.join(callRoomName(roomCode));
    respond({ ok: true, code: roomCode, mode: room.mode, participants: existing });
    socket.to(callRoomName(roomCode)).emit("call:participant-joined", {
      peerId: socket.id, userId, name: meNameCache.get(userId) || "A Pinglet friend"
    });
  });

  socket.on("call:signal", async ({ toPeerId, description, candidate } = {}) => {
    const code = socket.data.callRoomCode;
    const room = code && callRooms.get(code);
    if (!room || typeof toPeerId !== "string" || toPeerId === socket.id || !room.participants.has(toPeerId)) return;
    const sender = room.participants.get(socket.id);
    const recipient = room.participants.get(toPeerId);
    if (await areBlockedEither(sender.userId, recipient.userId)) return;
    if (description && (["offer", "answer"].includes(description.type) && typeof description.sdp === "string" && description.sdp.length <= 20000)) {
      io.to(toPeerId).emit("call:signal", { fromPeerId: socket.id, fromName: sender.name, description });
    } else if (candidate && typeof candidate.candidate === "string" && candidate.candidate.length <= 4096) {
      io.to(toPeerId).emit("call:signal", { fromPeerId: socket.id, fromName: sender.name, candidate });
    }
  });

  socket.on("call:reaction", ({ emoji } = {}) => {
    const code = socket.data.callRoomCode;
    const room = code && callRooms.get(code);
    const allowed = ["👏", "❤️", "😂", "🎉", "🔥", "👍"];
    if (!room || !allowed.includes(emoji)) return;
    const sender = room.participants.get(socket.id);
    io.to(callRoomName(code)).emit("call:reaction", { emoji, name: sender.name });
  });

  socket.on("call:leave", () => leaveCallRoom(socket));

  socket.on("snake:join", async ({peerId}={}) => {
    try {
      if (typeof peerId!=="string" || peerId===userId || !await areFriends(userId,peerId)) {
        socket.emit("snake:error",{message:"You can only play Snake Duel with a saved friend."}); return;
      }
      const key=snakeRoomKey(userId,peerId);
      let game=snakeRooms.get(key);
      if (!game) { game=newSnakeGame(key,[userId,peerId].sort()); snakeRooms.set(key,game); }
      socket.join(key);
      if (!game.sockets.has(userId)) game.sockets.set(userId,new Set());
      game.sockets.get(userId).add(socket.id);
      io.to(peerId).emit("snake:invite",{fromId:userId,fromName:meNameCache.get(userId)||"Your friend"});
      if (game.sockets.has(game.ids[0]) && game.sockets.has(game.ids[1])) startSnakeGame(game);
      else { game.status="waiting"; broadcastSnake(game); }
    } catch { socket.emit("snake:error",{message:"Could not join Snake Duel right now."}); }
  });
  socket.on("snake:direction", ({peerId,direction}={}) => {
    if (!["up","down","left","right"].includes(direction) || typeof peerId!=="string") return;
    const game=snakeRooms.get(snakeRoomKey(userId,peerId));
    if (!game || game.status!=="playing" || !game.ids.includes(userId)) return;
    const snake=game.snakes.find(s=>s.id===userId);
    if (snake && opposite[snake.direction]!==direction) snake.nextDirection=direction;
  });
  socket.on("snake:restart", ({peerId}={}) => {
    if (typeof peerId!=="string") return;
    const game=snakeRooms.get(snakeRoomKey(userId,peerId));
    if (game && game.status==="finished" && game.sockets.has(game.ids[0]) && game.sockets.has(game.ids[1])) startSnakeGame(game);
  });
  socket.on("snake:leave", ({peerId}={}) => {
    if (typeof peerId!=="string") return;
    const key=snakeRoomKey(userId,peerId),game=snakeRooms.get(key);
    if (game) {
      const set=game.sockets.get(userId);
      if (set) { set.delete(socket.id); if (!set.size) game.sockets.delete(userId); }
      socket.leave(key);
      if (game.timer) { clearInterval(game.timer); game.timer=null; }
      game.status="waiting"; broadcastSnake(game);
    }
  });
  socket.on("disconnect", () => {
    leaveCallRoom(socket);
    for (const [key,game] of snakeRooms) {
      const set=game.sockets.get(userId);
      if (set) {
        set.delete(socket.id);
        if (!set.size) game.sockets.delete(userId);
        if (game.timer) { clearInterval(game.timer); game.timer=null; }
        game.status="waiting"; broadcastSnake(game);
      }
    }
  });
});
const meNameCache=new Map();
async function cacheNames() {
  try { const result=await pool.query("SELECT id,name FROM users"); result.rows.forEach(u=>meNameCache.set(u.id,u.name)); } catch {}
}
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir, {
  index: false,
  etag: true,
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith("sw.js") || filePath.endsWith("index.html") || filePath.endsWith("manifest.webmanifest")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get(["/games", "/call-rooms"], (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/invite/:code", (req, res) => {
  if (!/^[a-f0-9]{14}$/i.test(req.params.code)) return res.status(404).send("Invite not found.");
  res.sendFile(path.join(publicDir, "index.html"));
});
app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((req, res) => res.status(404).type("text/plain").send("Page not found."));
initializeDatabase().then(async()=>{await cacheNames();server.listen(PORT,"0.0.0.0",()=>console.log("Pinglet listening on port "+PORT));})
.catch(error=>{console.error("Database initialization failed:",error.message);process.exit(1);});
