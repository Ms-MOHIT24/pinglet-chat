require("dotenv").config();
const express = require("express");
const http = require("http");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
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
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
const db = new Database(process.env.DB_PATH || "pinglet.sqlite");
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"], imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "64kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });

db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
 password TEXT NOT NULL, pubkey TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages(
 id TEXT PRIMARY KEY, conversation TEXT NOT NULL, sender TEXT NOT NULL,
 recipient TEXT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL,
 created TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS msg_pair ON messages(conversation, created);
`);
app.use(express.static(path.join(__dirname, "public")));

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
  return typeof value === "string" && value.length > 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

app.get("/health", (req, res) => res.json({ ok: true, service: "pinglet-chat" }));
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
    do { code = friendCode(); } while (db.prepare("SELECT 1 FROM users WHERE code=?").get(code));
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO users(id,name,code,password,pubkey) VALUES(?,?,?,?,?)")
      .run(id, name, code, await bcrypt.hash(password, 12), JSON.stringify(pubkey));
    const user = { id, name, code, pubkey };
    res.json({ token: tokenFor(user), user });
  } catch {
    res.status(500).json({ error: "Could not create your account." });
  }
});
app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const code = typeof req.body.code === "string" ? req.body.code.toUpperCase() : "";
    const user = db.prepare("SELECT * FROM users WHERE code=?").get(code);
    if (!user || typeof req.body.password !== "string" ||
        !await bcrypt.compare(req.body.password, user.password)) {
      return res.status(401).json({ error: "Friend code or password is incorrect." });
    }
    res.json({
      token: tokenFor(user),
      user: { id: user.id, name: user.name, code: user.code, pubkey: JSON.parse(user.pubkey) }
    });
  } catch {
    res.status(400).json({ error: "Invalid sign-in request." });
  }
});
app.get("/api/me", auth, (req, res) => {
  const user = db.prepare("SELECT id,name,code,pubkey FROM users WHERE id=?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "Account not found." });
  user.pubkey = JSON.parse(user.pubkey);
  res.json({ user });
});
app.get("/api/lookup/:code", auth, authLimiter, (req, res) => {
  const user = db.prepare("SELECT id,name,code,pubkey FROM users WHERE code=?")
    .get(String(req.params.code).toUpperCase());
  if (!user) return res.status(404).json({ error: "No user found with that friend code." });
  user.pubkey = JSON.parse(user.pubkey);
  res.json({ user });
});
app.get("/api/messages/:peer", auth, (req, res) => {
  const peer = req.params.peer;
  if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(peer)) {
    return res.status(404).json({ error: "Friend not found." });
  }
  const conversation = [req.user.id, peer].sort().join(":");
  const messages = db.prepare(
    "SELECT id,sender,recipient,ciphertext,iv,created FROM messages WHERE conversation=? ORDER BY created DESC LIMIT 100"
  ).all(conversation).reverse();
  res.json({ messages });
});
app.post("/api/messages", auth, (req, res) => {
  const { recipient, ciphertext, iv } = req.body;
  if (typeof recipient !== "string" || !recipient || !validBase64(ciphertext) ||
      ciphertext.length > 12000 || !validBase64(iv) || Buffer.from(iv, "base64").length !== 12) {
    return res.status(400).json({ error: "Invalid encrypted message." });
  }
  if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(recipient)) {
    return res.status(404).json({ error: "Friend not found." });
  }
  const id = crypto.randomUUID();
  const conversation = [req.user.id, recipient].sort().join(":");
  db.prepare("INSERT INTO messages(id,conversation,sender,recipient,ciphertext,iv) VALUES(?,?,?,?,?,?)")
    .run(id, conversation, req.user.id, recipient, ciphertext, iv);
  const message = db.prepare("SELECT id,sender,recipient,ciphertext,iv,created FROM messages WHERE id=?").get(id);
  io.to(recipient).emit("message", message);
  res.json({ message });
});

io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth.token, SECRET, {
      issuer: "pinglet", audience: "pinglet-web"
    });
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});
io.on("connection", (socket) => socket.join(socket.user.id));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
server.listen(PORT, "0.0.0.0", () => console.log("Pinglet listening on port " + PORT));
