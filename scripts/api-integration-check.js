"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.TEST_PORT || 3187);
const base = "http://127.0.0.1:" + port;
const secret = process.env.JWT_SECRET || "pinglet-integration-test-secret-value-1234567890";
const adminToken = process.env.REPORTS_ADMIN_TOKEN || "pinglet-integration-moderator-token-1234567890";
let output = "";
let child;

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
  child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      JWT_SECRET: secret,
      REPORTS_ADMIN_TOKEN: adminToken,
      PUBLIC_URL: base,
      DATABASE_SSL: "disable"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  try {
    await waitForServer();
    pass("HTTP health check confirms PostgreSQL is reachable");

    const consentRejected = await register("No consent", "test-password-123", false);
    assert.equal(consentRejected.status, 400);
    pass("Registration rejects missing Terms consent");

    const alice = await register("Alice Test", "alice-password-123");
    assert.equal(alice.status, 200);
    assert.ok(alice.data.token && alice.data.user.id && alice.data.user.code);
    const aliceToken = alice.data.token;
    const aliceId = alice.data.user.id;
    pass("Account registration stores a new account after consent");

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
    const history = await request("/api/messages/" + bobId, { token: aliceToken });
    assert.equal(history.status, 200);
    assert.equal(history.data.messages.length, 1);
    pass("Encrypted message write and conversation history work");

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

    const blocked = await request("/api/users/" + bobId + "/block", {
      method: "POST", token: aliceToken, body: {}
    });
    assert.equal(blocked.status, 200);
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
  } catch (error) {
    process.stderr.write(output);
    throw error;
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise(resolve => child.once("exit", resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    }
  }
}

main().catch(error => {
  process.stderr.write((error.stack || String(error)) + "\n");
  process.exitCode = 1;
});
