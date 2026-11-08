"use strict";
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const path = require("node:path");
const assert = require("node:assert/strict");
const { io: createSocket } = require("socket.io-client");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.TEST_PORT || 3187);
const base = "http://127.0.0.1:" + port;
const secret = process.env.JWT_SECRET || "pinglet-integration-test-secret-value-1234567890";
const adminToken = process.env.REPORTS_ADMIN_TOKEN || "pinglet-integration-moderator-token-1234567890";
let output = "";
let child;
let testPool;
const sockets = [];

async function request(url, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(base + url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, headers: response.headers };
}
function connectSocket(token, origin) {
  return new Promise((resolve, reject) => {
    const options = { auth: { token }, transports: ["websocket"], reconnection: false };
    if (origin) options.extraHeaders = { Origin: origin };
    const socket = createSocket(base, options);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("Socket connection timed out.")); }, 8000);
    socket.once("connect", () => { clearTimeout(timeout); resolve(socket); });
    socket.once("connect_error", error => { clearTimeout(timeout); socket.close(); reject(error); });
  });
}
function nextSocketEvent(socket, event, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for socket event: " + event)), timeoutMs);
    socket.once(event, data => { clearTimeout(timer); resolve(data); });
  });
}
function socketAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for acknowledgement: " + event)), 6000);
    socket.emit(event, payload, result => { clearTimeout(timer); resolve(result); });
  });
}
function nextSocketEventWhere(socket, event, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const onEvent = data => {
      if (predicate(data)) { clearTimeout(timer); resolve(data); }
      else if (Date.now() >= deadline) { clearTimeout(timer); reject(new Error("Timed out waiting for matching socket event: " + event)); }
      else socket.once(event, onEvent);
    };
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error("Timed out waiting for matching socket event: " + event));
    }, timeoutMs);
    socket.once(event, onEvent);
  });
}
function pass(label) { process.stdout.write("PASS  " + label + "\n"); }
async function waitForServer() {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/health");
      if (response.ok) return;
      lastError = new Error("Health returned " + response.status);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw lastError || new Error("Server did not become ready.");
}
async function register(name, password, termsAccepted = true) {
  return request("/api/register", {
    method: "POST",
    body: {
      name,
      password,
      termsAccepted,
      pubkey: { kty: "EC", crv: "P-256", x: "integration-test-x", y: "integration-test-y" }
    }
  });
}
async function main() {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point to the CI PostgreSQL service.");
  testPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      JWT_SECRET: secret,
      REPORTS_ADMIN_TOKEN: adminToken,
      PUBLIC_URL: "https://pinglet-chat-staging.onrender.com",
      DATABASE_SSL: "disable"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  try {
    await waitForServer();
    pass("HTTP health check confirms PostgreSQL is reachable");

    const asyncFailure = await request("/api/__test/async-error");
    assert.equal(asyncFailure.status, 500);
    assert.equal(asyncFailure.data.error, "Something went wrong. Please try again.");
    assert.doesNotMatch(JSON.stringify(asyncFailure.data), /integration-only error detail|stack|database/i);
    pass("Rejected async route errors reach the sanitized central API error handler");

    const malformedJson = await fetch(base + "/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{"
    });
    assert.equal(malformedJson.status, 400);
    const malformedJsonBody = await malformedJson.json();
    assert.equal(malformedJsonBody.error, "Invalid request.");
    assert.doesNotMatch(JSON.stringify(malformedJsonBody), /SyntaxError|Unexpected token|stack/i);
    pass("Malformed JSON receives a sanitized API client error");

    const tooLargeResponse = await fetch(base + "/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X".repeat(90 * 1024) })
    });
    assert.equal(tooLargeResponse.status, 413);
    const tooLargeBody = await tooLargeResponse.json();
    assert.equal(tooLargeBody.error, "Request is too large.");
    assert.doesNotMatch(JSON.stringify(tooLargeBody), /PayloadTooLargeError|body-parser|stack/i);
    pass("Oversized JSON receives a sanitized API client error");

    const consentRejected = await register("No consent", "test-password-123", false);
    assert.equal(consentRejected.status, 400);
    pass("Registration rejects missing Terms consent");

    const alice = await register("Alice Test", "alice-password-123");
    assert.equal(alice.status, 200);
    assert.ok(alice.data.token && alice.data.user.id && alice.data.user.code);
    const aliceToken = alice.data.token;
    const aliceId = alice.data.user.id;
    pass("Account registration stores a new account after consent");

    const stagingOriginSocket = await connectSocket(aliceToken, "https://pinglet-chat-staging.onrender.com");
    sockets.push(stagingOriginSocket);
    pass("Socket.IO accepts the configured staging browser origin");
    await assert.rejects(connectSocket(aliceToken, "https://pinglet-chat-live.onrender.com"));
    pass("Socket.IO rejects the production browser origin when running as staging");

    const aliceMe = await request("/api/me", { token: aliceToken });
    assert.equal(aliceMe.status, 200);
    assert.equal(aliceMe.data.user.termsAccepted, true);
    pass("Authenticated account profile returns consent state");

    const bob = await register("Bob Test", "bob-password-123");
    assert.equal(bob.status, 200);
    const bobToken = bob.data.token;
    const bobId = bob.data.user.id;
    pass("Second account can be created");

    const pending = await request("/api/friend-requests", {
      method: "POST", token: bobToken, body: { code: alice.data.user.code }
    });
    assert.equal(pending.status, 200);
    assert.equal(pending.data.status, "pending");
    const accepted = await request("/api/friend-requests/" + pending.data.request.id + "/accept", {
      method: "POST", token: aliceToken, body: {}
    });
    assert.equal(accepted.status, 200);
    pass("Friend request and acceptance create a mutual connection");

    const message = await request("/api/messages", {
      method: "POST",
      token: bobToken,
      body: {
        recipient: aliceId,
        ciphertext: Buffer.from("encrypted-test-payload").toString("base64"),
        iv: Buffer.alloc(12, 7).toString("base64")
      }
    });
    assert.equal(message.status, 200);
    const seededCount = 105;
    const conversation = [aliceId, bobId].sort().join(":");
    const seededIds = Array.from({ length: seededCount }, () => randomUUID());
    const tiedCreated = new Date(Date.now() - (seededCount + 10) * 1000).toISOString();
    const seededCreated = Array.from({ length: seededCount }, (_, index) =>
      index < 3 ? tiedCreated : new Date(Date.now() - (seededCount - index) * 1000).toISOString()
    );
    await testPool.query(
      `INSERT INTO messages(id,conversation,sender,recipient,ciphertext,iv,created)
       SELECT seeded.id,$1,$2,$3,'dGVzdA==','AAAAAAAAAAAAAAAA',seeded.created
       FROM unnest($4::uuid[],$5::timestamptz[]) AS seeded(id,created)`,
      [conversation, bobId, aliceId, seededIds, seededCreated]
    );

    const history = await request("/api/messages/" + bobId, { token: aliceToken });
    assert.equal(history.status, 200);
    assert.equal(history.data.messages.length, 100);
    assert.equal(history.data.hasMore, true);
    assert.ok(typeof history.data.nextCursor === "string" && history.data.nextCursor.length > 0);
    const invalidCursor = await request("/api/messages/" + bobId + "?before=not-a-valid-cursor", { token: aliceToken });
    assert.equal(invalidCursor.status, 400);
    const olderPage = await request("/api/messages/" + bobId + "?before=" + encodeURIComponent(history.data.nextCursor), { token: aliceToken });
    assert.equal(olderPage.status, 200);
    assert.equal(olderPage.data.messages.length, 6);
    assert.equal(olderPage.data.hasMore, false);
    assert.equal(olderPage.data.nextCursor, null);
    const allHistory = [...olderPage.data.messages, ...history.data.messages];
    assert.equal(new Set(allHistory.map(message => message.id)).size, 106);
    assert.ok(allHistory.every((message, index) => index === 0 ||
      (String(allHistory[index - 1].created).localeCompare(String(message.created)) ||
        String(allHistory[index - 1].id).localeCompare(String(message.id))) <= 0));
    pass("Conversation history paginates beyond 100 messages with validated cursors and no duplicate rows");

    const report = await request("/api/reports", {
      method: "POST",
      token: aliceToken,
      body: { reportedUserId: bobId, category: "other", details: "Integration test report details." }
    });
    assert.equal(report.status, 201);
    const noModerator = await request("/api/moderation/reports");
    assert.equal(noModerator.status, 401);
    const moderation = await request("/api/moderation/reports", {
      headers: { Authorization: "Bearer " + adminToken }
    });
    assert.equal(moderation.status, 200);
    assert.ok(moderation.data.reports.some(item => item.id === report.data.reportId));
    pass("Report submission and protected moderation queue work");



    const aliceSocket = stagingOriginSocket;
    const bobSocket = await connectSocket(bobToken);
    sockets.push(aliceSocket, bobSocket);
    pass("Authenticated Socket.IO connections work for both friends");

    const createdRoom = await socketAck(aliceSocket, "call:create", { mode: "voice" });
    assert.equal(createdRoom.ok, true);
    assert.match(createdRoom.code, /^\d{4}$/);
    const participantJoined = nextSocketEvent(aliceSocket, "call:participant-joined");
    const joinedRoom = await socketAck(bobSocket, "call:join", { code: createdRoom.code });
    assert.equal(joinedRoom.ok, true);
    assert.equal(joinedRoom.mode, "voice");
    assert.equal(joinedRoom.participants.length, 1);
    const joinedNotice = await participantJoined;
    assert.equal(joinedNotice.userId, bobId);
    pass("Private call room creation, saved-friend join and participant updates work");

    const incomingSignal = nextSocketEvent(bobSocket, "call:signal");
    aliceSocket.emit("call:signal", {
      toPeerId: bobSocket.id,
      description: { type: "offer", sdp: "v=0\r\n" }
    });
    const signal = await incomingSignal;
    assert.equal(signal.description.type, "offer");
    assert.equal(signal.fromPeerId, aliceSocket.id);
    const incomingReaction = nextSocketEvent(bobSocket, "call:reaction");
    aliceSocket.emit("call:reaction", { emoji: "👏" });
    const reaction = await incomingReaction;
    assert.equal(reaction.emoji, "👏");
    pass("Call signaling and reactions relay only to a room participant");

    const incomingSnakeInvite = nextSocketEvent(bobSocket, "snake:invite");
    aliceSocket.emit("snake:join", { peerId: bobId });
    const invite = await incomingSnakeInvite;
    assert.equal(invite.fromId, aliceId);
    const aliceSnakeState = nextSocketEventWhere(aliceSocket, "snake:state", state => state.status === "playing");
    bobSocket.emit("snake:join", { peerId: aliceId });
    const gameState = await aliceSnakeState;
    assert.equal(gameState.players.length, 2);
    pass("Snake Duel friend invitations and two-player game start work");

    const callLeft = nextSocketEvent(bobSocket, "call:participant-left");
    const snakeEnded = nextSocketEvent(bobSocket, "snake:error");
    const blocked = await request("/api/users/" + bobId + "/block", {
      method: "POST", token: aliceToken, body: {}
    });
    assert.equal(blocked.status, 200);
    const callLeftNotice = await callLeft;
    assert.equal(callLeftNotice.peerId, aliceSocket.id);
    const snakeEndedNotice = await snakeEnded;
    assert.match(snakeEndedNotice.message, /blocked the other/i);
    pass("Blocking immediately ends active call and Snake Duel sessions");
    const blockedList = await request("/api/blocks", { token: aliceToken });
    assert.ok(blockedList.data.blocked.some(item => item.id === bobId));
    const messageAfterBlock = await request("/api/messages", {
      method: "POST",
      token: bobToken,
      body: {
        recipient: aliceId,
        ciphertext: Buffer.from("blocked-payload").toString("base64"),
        iv: Buffer.alloc(12, 8).toString("base64")
      }
    });
    assert.equal(messageAfterBlock.status, 403);
    pass("Blocking removes friendship and prevents message sending");

    const unblocked = await request("/api/users/" + bobId + "/block", { method: "DELETE", token: aliceToken });
    assert.equal(unblocked.status, 200);
    pass("Unblock endpoint works");
    const wrongDelete = await request("/api/me", {
      method: "DELETE", token: bobToken, body: { password: "incorrect-password" }
    });
    assert.equal(wrongDelete.status, 401);
    const deleted = await request("/api/me", {
      method: "DELETE", token: bobToken, body: { password: "bob-password-123" }
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.deleted, true);
    const reportAfterDelete = await request("/api/moderation/reports", {
      headers: { Authorization: "Bearer " + adminToken }
    });
    assert.ok(reportAfterDelete.data.reports.some(item => item.id === report.data.reportId && item.reported_user_id === null));
    pass("Account deletion removes user data and anonymises report subject");

    for (const page of ["/terms.html", "/privacy.html", "/child-safety.html", "/delete-account.html", "/delete-account.js", "/vendor/socket.io.js", "/vendor/jsQR.js"]) {
      const response = await fetch(base + page);
      assert.equal(response.status, 200, page + " should be publicly accessible");
    }
    pass("Public terms, privacy, child-safety and deletion pages load");

    const cors = await fetch(base + "/api/me", {
      method: "OPTIONS",
      headers: { Origin: "https://localhost", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" }
    });
    assert.equal(cors.status, 204);
    assert.equal(cors.headers.get("access-control-allow-origin"), "https://localhost");
    pass("Capacitor Android local-origin CORS preflight works");

    const stagingCors = await fetch(base + "/api/me", {
      method: "OPTIONS",
      headers: { Origin: "https://pinglet-chat-staging.onrender.com", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" }
    });
    assert.equal(stagingCors.status, 204);
    assert.equal(stagingCors.headers.get("access-control-allow-origin"), "https://pinglet-chat-staging.onrender.com");

    const productionCors = await fetch(base + "/api/me", {
      method: "OPTIONS",
      headers: { Origin: "https://pinglet-chat-live.onrender.com", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" }
    });
    assert.equal(productionCors.status, 204);
    assert.equal(productionCors.headers.get("access-control-allow-origin"), null);

    const pageResponse = await fetch(base + "/");
    assert.equal(pageResponse.status, 200);
    const csp = pageResponse.headers.get("content-security-policy") || "";
    const connectDirective = csp.split(";").map(value => value.trim()).find(value => value.startsWith("connect-src ")) || "";
    const connectSources = connectDirective.split(/\s+/).slice(1);
    assert.ok(connectSources.includes("'self'"));
    assert.ok(connectSources.includes("https://pinglet-chat-staging.onrender.com"));
    assert.ok(connectSources.includes("wss://pinglet-chat-staging.onrender.com"));
    assert.ok(!connectSources.includes("https://pinglet-chat-live.onrender.com"));
    assert.ok(!connectSources.includes("wss://pinglet-chat-live.onrender.com"));
    assert.ok(!connectSources.includes("ws:"));
    assert.ok(!connectSources.includes("wss:"));
    pass("Staging HTTP CORS and CSP allow only the configured web origin");
  } catch (error) {
    process.stderr.write(output);
    throw error;
  } finally {
    sockets.forEach(socket => socket.disconnect());
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise(resolve => child.once("exit", resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    }
    if (testPool) await testPool.end();
  }
}

main().catch(error => {
  process.stderr.write((error.stack || String(error)) + "\n");
  process.exitCode = 1;
});
