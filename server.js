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
if (!SECRET || Buffer.byteLength(SECRET) < 32) {
  console.error("JWT_SECRET must be configured with at least 32 random bytes.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Configure a persistent PostgreSQL database.");
  process.exit(1);
}
const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "64kb" }));
app.use("/api", rateLimit({ windowMs: 60000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name VARCHAR(24) NOT NULL,
      code VARCHAR(14) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      pubkey JSONB NOT NULL,
      created TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      conversation TEXT NOT NULL,
      sender UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      created TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS msg_pair ON messages(conversation, created);
    CREATE TABLE IF NOT EXISTS friend_requests (
      id UUID PRIMARY KEY,
      sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
      created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(sender_id, receiver_id),
      CHECK(sender_id <> receiver_id)
    );
    CREATE INDEX IF NOT EXISTS friend_requests_receiver_status ON friend_requests(receiver_id, status, created DESC);
    CREATE TABLE IF NOT EXISTS friendships (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label VARCHAR(32) NOT NULL DEFAULT 'Friend',
      created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, friend_id),
      CHECK(user_id <> friend_id)
    );
    CREATE INDEX IF NOT EXISTS friendships_friend_idx ON friendships(friend_id);
  `);
}
const friendCode = () => crypto.randomBytes(7).toString("hex").toUpperCase();
const tokenFor = (user) => jwt.sign({ id: user.id }, SECRET, {
  expiresIn: "12h", issuer: "pinglet", audience: "pinglet-web"
});
function auth(req, res, next) {
  try {
    req.user = jwt.verify((req.headers.authorization || "").replace(/^Bearer /, ""), SECRET, {
      issuer: "pinglet", audience: "pinglet-web"
    });
    next();
  } catch {
    res.status(401).json({ error: "Please sign in again." });
  }
}
function validPubkey(key) {
  return !!key && key.kty === "EC" && key.crv === "P-256" &&
    typeof key.x === "string" && typeof key.y === "string";
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

app.get("/health", async (req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true, service: "pinglet-chat", database: "connected" }); }
  catch { res.status(503).json({ ok: false, service: "pinglet-chat", database: "unavailable" }); }
});
app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const password = req.body.password;
    const pubkey = req.body.pubkey;
    if (!name || name.length > 24 || typeof password !== "string" ||
        password.length < 8 || password.length > 128 || !validPubkey(pubkey)) {
      return res.status(400).json({ error: "Enter a name, a valid public key and an 8–128 character password." });
    }
    let code;
    do { code = friendCode(); } while ((await pool.query("SELECT 1 FROM users WHERE code=$1", [code])).rowCount);
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO users(id,name,code,password,pubkey) VALUES($1,$2,$3,$4,$5::jsonb)",
      [id, name, code, await bcrypt.hash(password, 12), JSON.stringify(pubkey)]);
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
    if (!user || typeof req.body.password !== "string" ||
        !await bcrypt.compare(req.body.password, user.password)) {
      return res.status(401).json({ error: "Friend code or password is incorrect." });
    }
    res.json({
      token: tokenFor(user),
      user: { id: user.id, name: user.name, code: user.code, pubkey: user.pubkey }
    });
  } catch {
    res.status(400).json({ error: "Invalid sign-in request." });
  }
});
app.get("/api/me", auth, async (req, res) => {
  const result = await pool.query("SELECT id,name,code,pubkey FROM users WHERE id=$1", [req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Account not found." });
  res.json({ user: result.rows[0] });
});
app.get("/api/me/invite-qr", auth, async (req, res) => {
  const result = await pool.query("SELECT code FROM users WHERE id=$1", [req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Account not found." });
  const url = inviteOrigin(req) + "/invite/" + result.rows[0].code;
  const qr = await QRCode.toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: "M", color: { dark: "#111827", light: "#FFFFFF" } });
  res.json({ url, qr });
});
app.get("/api/lookup/:code", auth, authLimiter, async (req, res) => {
  const result = await pool.query("SELECT id,name,code,pubkey FROM users WHERE code=$1", [String(req.params.code).toUpperCase()]);
  if (!result.rowCount) return res.status(404).json({ error: "No user found with that friend code." });
  res.json({ user: result.rows[0] });
});
app.get("/api/friends", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT u.id,u.name,u.code,u.pubkey,f.label,f.created
    FROM friendships f JOIN users u ON u.id=f.friend_id
    WHERE f.user_id=$1 ORDER BY lower(u.name), f.created
  `, [req.user.id]);
  res.json({ friends: result.rows });
});
app.get("/api/friend-requests", auth, async (req, res) => {
  const [incoming, outgoing] = await Promise.all([
    pool.query(`SELECT r.id,r.created,u.id AS user_id,u.name,u.code
      FROM friend_requests r JOIN users u ON u.id=r.sender_id
      WHERE r.receiver_id=$1 AND r.status='pending' ORDER BY r.created DESC`, [req.user.id]),
    pool.query(`SELECT r.id,r.created,u.id AS user_id,u.name,u.code
      FROM friend_requests r JOIN users u ON u.id=r.receiver_id
      WHERE r.sender_id=$1 AND r.status='pending' ORDER BY r.created DESC`, [req.user.id])
  ]);
  res.json({ incoming: incoming.rows, outgoing: outgoing.rows });
});
app.post("/api/friend-requests", auth, async (req, res) => {
  const code = typeof req.body.code === "string" ? req.body.code.trim().toUpperCase() : "";
  if (!code) return res.status(400).json({ error: "Enter a friend code." });
  const targetResult = await pool.query("SELECT id,name,code FROM users WHERE code=$1", [code]);
  const target = targetResult.rows[0];
  if (!target) return res.status(404).json({ error: "No account uses that friend code." });
  if (target.id === req.user.id) return res.status(400).json({ error: "That's your own friend code." });
  if (await areFriends(req.user.id, target.id)) return res.json({ status: "friends", friend: target });
  const reverse = await pool.query(
    "SELECT id FROM friend_requests WHERE sender_id=$1 AND receiver_id=$2 AND status='pending'",
    [target.id, req.user.id]
  );
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
  const previous = await pool.query(
    "SELECT id,status FROM friend_requests WHERE sender_id=$1 AND receiver_id=$2",
    [req.user.id, target.id]
  );
  let request;
  if (previous.rowCount) {
    request = await pool.query("UPDATE friend_requests SET status='pending',created=NOW() WHERE id=$1 RETURNING id,status,created", [previous.rows[0].id]);
  } else {
    request = await pool.query(
      "INSERT INTO friend_requests(id,sender_id,receiver_id) VALUES($1,$2,$3) RETURNING id,status,created",
      [crypto.randomUUID(), req.user.id, target.id]
    );
  }
  io.to(target.id).emit("friend-request", { id: request.rows[0].id });
  res.json({ status: "pending", request: request.rows[0], friend: target });
});
app.post("/api/friend-requests/:id/accept", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT id,sender_id,receiver_id FROM friend_requests WHERE id=$1 AND receiver_id=$2 AND status='pending' FOR UPDATE",
      [req.params.id, req.user.id]
    );
    if (!found.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Friend request not found." }); }
    const request = found.rows[0];
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
  const result = await pool.query(
    "UPDATE friend_requests SET status='declined' WHERE id=$1 AND receiver_id=$2 AND status='pending' RETURNING id",
    [req.params.id, req.user.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Friend request not found." });
  res.json({ status: "declined" });
});
app.patch("/api/friends/:id/label", auth, async (req, res) => {
  const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
  const allowed = ["Friend", "True Friend", "Bestie", "Love", "Partner in Crime", "My Person"];
  if (!allowed.includes(label)) return res.status(400).json({ error: "Choose a label from the list." });
  const result = await pool.query(
    "UPDATE friendships SET label=$1 WHERE user_id=$2 AND friend_id=$3 RETURNING label",
    [label, req.user.id, req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Saved friend not found." });
  res.json({ label });
});

app.get("/api/messages/:peer", auth, async (req, res) => {
  const peer = req.params.peer;
  if (!await areFriends(req.user.id, peer)) return res.status(403).json({ error: "Add this person as a friend before chatting." });
  const conversation = [req.user.id, peer].sort().join(":");
  const result = await pool.query(
    "SELECT id,sender,recipient,ciphertext,iv,created FROM messages WHERE conversation=$1 ORDER BY created DESC LIMIT 100",
    [conversation]
  );
  res.json({ messages: result.rows.reverse() });
});
app.post("/api/messages", auth, async (req, res) => {
  const { recipient, ciphertext, iv } = req.body;
  if (typeof recipient !== "string" || !recipient || !validBase64(ciphertext) ||
      ciphertext.length > 12000 || !validBase64(iv) || Buffer.from(iv, "base64").length !== 12) {
    return res.status(400).json({ error: "Invalid encrypted message." });
  }
  if (!await areFriends(req.user.id, recipient)) return res.status(403).json({ error: "You can only message saved friends." });
  const id = crypto.randomUUID(), conversation = [req.user.id, recipient].sort().join(":");
  const result = await pool.query(
    "INSERT INTO messages(id,conversation,sender,recipient,ciphertext,iv) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,sender,recipient,ciphertext,iv,created",
    [id, conversation, req.user.id, recipient, ciphertext, iv]
  );
  const message = result.rows[0];
  io.to(recipient).emit("message", message);
  res.json({ message });
});

io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth.token, SECRET, { issuer: "pinglet", audience: "pinglet-web" });
    next();
  } catch { next(new Error("Unauthorized")); }
});
io.on("connection", (socket) => socket.join(socket.user.id));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

initializeDatabase().then(() => {
  server.listen(PORT, "0.0.0.0", () => console.log("Pinglet listening on port " + PORT));
}).catch((error) => {
  console.error("Database initialization failed:", error.message);
  process.exit(1);
});
