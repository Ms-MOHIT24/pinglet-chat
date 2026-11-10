"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.REGISTRATION_GATE_TEST_PORT || 3191);
const base = "http://127.0.0.1:" + port;
let child;
let output = "";

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("Pinglet test server exited before becoming ready.\n" + output);
    }
    try {
      const response = await fetch(base + "/health", { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error("Health returned " + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw lastError || new Error("Pinglet test server did not become ready.\n" + output);
}

async function stopServer() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 8000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function main() {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point to the disposable CI PostgreSQL database.");
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    JWT_SECRET: process.env.JWT_SECRET || "pinglet-registration-gate-test-secret-0123456789",
    DATABASE_SSL: "disable"
  };
  // Test the production-safe default: unset means registration remains closed.
  delete env.PUBLIC_SIGNUPS_ENABLED;

  child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });

  try {
    await waitForHealth();
    const response = await fetch(base + "/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Gate Test",
        password: "registration-gate-test-password",
        termsAccepted: true,
        pubkey: { kty: "EC", crv: "P-256", x: "test-x", y: "test-y" }
      })
    });
    const data = await response.json().catch(() => ({}));

    assert.equal(response.status, 503, "Registration must be unavailable unless explicitly enabled.");
    assert.match(data.error || "", /registration is temporarily closed/i);
    assert.equal(data.token, undefined, "A closed registration attempt must not create a session.");
    assert.equal(response.headers.get("cache-control"), "no-store");

    process.stdout.write("PASS  Public registration is closed by default when PUBLIC_SIGNUPS_ENABLED is unset.\n");
  } finally {
    await stopServer();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  if (output) console.error("Pinglet test server output:\n" + output);
  process.exitCode = 1;
});
