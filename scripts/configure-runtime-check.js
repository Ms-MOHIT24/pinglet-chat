"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const sourceRoot = path.resolve(__dirname, "..");
const productionOrigin = "https://pinglet-chat-live.onrender.com";
const stagingOrigin = "https://pinglet-chat-staging.onrender.com";

function createWorkspace(apiOrigin) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinglet-runtime-check-"));
  const scriptsDir = path.join(root, "scripts");
  const publicDir = path.join(root, "public");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, "scripts", "configure-runtime.js"), path.join(scriptsDir, "configure-runtime.js"));
  fs.copyFileSync(path.join(sourceRoot, "public", "index.html"), path.join(publicDir, "index.html"));

  const env = { ...process.env };
  delete env.PINGLET_API_ORIGIN;
  if (apiOrigin !== undefined) env.PINGLET_API_ORIGIN = apiOrigin;

  const result = spawnSync(process.execPath, [path.join(scriptsDir, "configure-runtime.js")], {
    cwd: root,
    env,
    encoding: "utf8"
  });

  return { root, publicDir, result };
}

function verifyGeneratedPolicy(configuredOrigin, expectedOrigin, label) {
  const workspace = createWorkspace(configuredOrigin);
  try {
    assert.equal(workspace.result.status, 0, workspace.result.stderr || workspace.result.stdout);
    const html = fs.readFileSync(path.join(workspace.publicDir, "index.html"), "utf8");
    const runtimeConfig = fs.readFileSync(path.join(workspace.publicDir, "runtime-config.js"), "utf8");
    const meta = html.match(/<meta\s+http-equiv="Content-Security-Policy" content="([^"]+)">/i);
    assert.ok(meta, "generated native CSP meta tag is missing");
    const connectDirective = meta[1].split(";").map(value => value.trim()).find(value => value.startsWith("connect-src "));
    assert.ok(connectDirective, "generated native CSP connect-src is missing");
    const sources = connectDirective.split(/\s+/).slice(1);
    const otherOrigin = expectedOrigin === productionOrigin ? stagingOrigin : productionOrigin;
    const expectedSocketOrigin = "wss://" + new URL(expectedOrigin).host;
    const otherSocketOrigin = "wss://" + new URL(otherOrigin).host;

    assert.ok(sources.includes("'self'"));
    assert.ok(sources.includes(expectedOrigin));
    assert.ok(sources.includes(expectedSocketOrigin));
    assert.ok(!sources.includes(otherOrigin));
    assert.ok(!sources.includes(otherSocketOrigin));
    assert.ok(!sources.includes("ws:"));
    assert.ok(!sources.includes("wss:"));
    assert.ok(runtimeConfig.includes("apiOrigin: " + JSON.stringify(configuredOrigin || "")));
    process.stdout.write("PASS  " + label + " generates a matching, isolated native CSP\n");
  } finally {
    fs.rmSync(workspace.root, { recursive: true, force: true });
  }
}

verifyGeneratedPolicy(productionOrigin, productionOrigin, "Production Android runtime");
verifyGeneratedPolicy(stagingOrigin, stagingOrigin, "Staging Android runtime");
verifyGeneratedPolicy(undefined, productionOrigin, "Default Android runtime");

const invalid = createWorkspace("http://pinglet-chat-staging.onrender.com");
try {
  assert.notEqual(invalid.result.status, 0, "invalid HTTP API origin must be rejected");
  process.stdout.write("PASS  Invalid non-HTTPS Android API origins are rejected\n");
} finally {
  fs.rmSync(invalid.root, { recursive: true, force: true });
}
