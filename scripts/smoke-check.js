"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const html = read("public/index.html");
const app = read("public/app.js");
const server = read("server.js");
const css = read("public/style.css");
const sw = read("public/sw.js");
const packageJson = JSON.parse(read("package.json"));

function check(label, condition) {
  assert.ok(condition, label);
  process.stdout.write("PASS  " + label + "\n");
}

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check("HTML IDs are unique", duplicates.length === 0);
check("RPS has home, navigation, and direct URL entry points",
  html.includes('id="welcomeRps" href="/games"') &&
  html.includes('id="gamesNav"') &&
  html.includes('id="topGames"') && html.includes('href="/games"') &&
  server.includes('app.get(["/games", "/call-rooms"]') &&
  app.includes('location.pathname === "/games"'));
check("RPS arena and all three moves are present",
  ["rpsArena", "gameResult", "rpsCountdown"].every(id => ids.includes(id)) &&
  ["rock", "paper", "scissors"].every(move => html.includes('data-choice="' + move + '"')) &&
  app.includes("playRpsRound"));
check("RPS animation honours reduced-motion preferences",
  css.includes("pinglet-view-enter") &&
  css.includes("@media(prefers-reduced-motion:reduce)"));
check("Four-digit call rooms cap at four participants",
  server.includes("callRoomCapacity = 4") &&
  server.includes("crypto.randomInt(0, 10000)") &&
  server.includes("/^\\d{4}$/") &&
  server.includes("attempts.count >= 8"));
check("Voice and video room signaling is authenticated and wired",
  ["call:create", "call:join", "call:signal", "call:reaction", "call:leave"].every(event => server.includes(event) && app.includes(event)) &&
  app.includes("new RTCPeerConnection") &&
  app.includes("getUserMedia"));
check("Walkie-talkie recording and encrypted playback are wired",
  ids.includes("walkieTalkie") &&
  app.includes("new MediaRecorder") &&
  app.includes("PINGLET_VOICE_V1|") &&
  app.includes("encryptMessage(payload, activePeer)") &&
  app.includes("URL.createObjectURL"));
check("Voice clip and message request sizes are bounded",
  app.includes("voiceMaxDurationMs = 8000") &&
  app.includes("voiceMaxBytes = 30 * 1024") &&
  server.includes('express.json({ limit: "80kb" })') &&
  server.includes("ciphertext.length > 60000"));
check("Call room and RPS views have hidden-state styling",
  css.includes(".call-rooms.hidden{display:none!important}") &&
  css.includes(".games"));
check("Chat drafts stay with their friend and empty messages cannot be sent",
  app.includes("const messageDrafts = new Map()") &&
  app.includes("messageDrafts.set(previousPeerId, previousDraft)") &&
  app.includes("messageDrafts.get(friend.id)") &&
  app.includes("messageSending = true") &&
  app.includes("updateComposerState()") &&
  html.includes('title="Write a message to enable sending" disabled'));
check("Read-only API requests retry transient wake-up errors",
  app.includes("const canRetry = method === \"GET\"") &&
  app.includes("[502, 503, 504]") &&
  app.includes("Waking up…") &&
  app.includes("retryDelays"));
check("Shared web and Android motion system",
  css.includes("Pinglet motion system") &&
  css.includes("pinglet-ambient-drift") &&
  css.includes("pinglet-message-in") &&
  css.includes("prefers-reduced-motion:reduce") &&
  app.includes("function show(view)"));
check("Service-worker cache version is current",
  /CACHE_NAME = "pinglet-shell-v15"/.test(sw));


check("Terms acceptance is required for account creation and social writes",
  server.includes("terms_accepted_at") &&
  server.includes("req.body.termsAccepted !== true") &&
  server.includes("async function termsRequired") &&
  server.includes("auth, termsRequired") &&
  server.includes("Please accept Pinglet's Terms first") &&
  html.includes('id="termsAccepted"') &&
  html.includes('id="termsModal"') &&
  app.includes('api("/me/terms"'));
check("Account deletion works in-app and on the public web",
  server.includes('app.delete("/api/me"') &&
  server.includes('DELETE FROM users WHERE id=$1') &&
  html.includes('id="deleteAccountForm"') &&
  html.includes('href="/delete-account.html"') &&
  app.includes('api("/me", { method: "DELETE"') &&
  fs.existsSync(path.join(root, "public/delete-account.html")) &&
  fs.existsSync(path.join(root, "public/delete-account.js")));
check("Report, block and unblock controls are wired to protected APIs",
  server.includes("CREATE TABLE IF NOT EXISTS blocked_users") &&
  server.includes('app.post("/api/users/:id/block"') &&
  server.includes('app.delete("/api/users/:id/block"') &&
  server.includes('app.post("/api/reports"') &&
  server.includes('app.get("/api/moderation/reports"') &&
  server.includes("timingSafeEqual") &&
  html.includes('id="reportPeer"') &&
  html.includes('id="blockPeer"') &&
  html.includes('id="safetyNav"') &&
  app.includes('api("/reports"') &&
  app.includes('api("/blocks"'));
check("Policy and child-safety pages are present and accessible",
  fs.existsSync(path.join(root, "public/terms.html")) &&
  fs.existsSync(path.join(root, "public/privacy.html")) &&
  fs.existsSync(path.join(root, "public/child-safety.html")) &&
  fs.existsSync(path.join(root, "public/delete-account.html")) &&
  html.includes('href="/terms.html"') &&
  html.includes('href="/privacy.html"'));
const capacitor = JSON.parse(read("capacitor.config.json"));
check("Socket.IO and QR scanner runtimes are bundled by npm install",
  packageJson.scripts.postinstall === "node scripts/copy-vendor.js" &&
  packageJson.dependencies.jsqr === "^1.4.0" &&
  fs.existsSync(path.join(root, "scripts/copy-vendor.js")) &&
  html.includes('src="/vendor/socket.io.js" defer') &&
  html.includes('src="/vendor/jsQR.js" defer') &&
  html.includes('src="/app.js" defer') &&
  !html.includes("cdn.jsdelivr.net/npm/jsqr") &&
  !html.includes("onrender.com/socket.io/socket.io.js"));

check("Android ships its own web UI instead of remote-loading the website",
  (!capacitor.server || !capacitor.server.url) &&
  app.includes("const API_ORIGIN = isNativeShell ?") &&
  html.includes('src="/vendor/socket.io.js" defer') &&
  server.includes('"https://localhost"') &&
  server.includes('"https://pinglet-chat-live.onrender.com"'));
check("Staging runtime config can target a separate API without changing production defaults",
  html.includes('<script src="/runtime-config.js" defer></script>') &&
  fs.existsSync(path.join(root, "public/runtime-config.js")) &&
  fs.existsSync(path.join(root, "scripts/configure-runtime.js")) &&
  app.includes("window.PINGLET_CONFIG") &&
  app.includes("configuredApiOrigin") &&
  server.includes("configuredPublicOrigin") &&
  server.includes("allowedOrigins.has(origin)"));

check("Android media permissions are included in generated native project",
  fs.existsSync(path.join(root, "scripts/configure-android-permissions.js")) &&
  ["android.permission.CAMERA", "android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"].every(permission =>
    read("scripts/configure-android-permissions.js").includes(permission)));

check("Blocked accounts are removed from active Snake Duel games",
  server.includes("removeBlockedPairFromSnakeGames") &&
  server.includes('game.status="finished"') &&
  server.includes('This game ended because one player blocked the other.'));

check("Call rooms require a saved, non-blocked friendship",
  server.includes('if (await areBlockedEither(userId, participant.userId) || !await areFriends(userId, participant.userId))') &&
  server.includes("removeBlockedPairFromCalls") &&
  server.includes("if (await areBlockedEither(sender.userId, recipient.userId)) return"));

check("Remote call tiles offer accessible report and block actions",
  app.includes("function addCallSafetyActions") &&
  app.includes("function blockCallParticipant") &&
  app.includes('openReportModal("Reported from a live call."') &&
  app.includes("person.userId") &&
  app.includes("reportTarget = { id: target.id, name: target.name"));

check("Dialogs expose managed focus, Escape and screen-reader state",
  app.includes("function setupModalAccessibility") &&
  app.includes("aria-modal") &&
  app.includes("aria-hidden") &&
  app.includes("focusRestore") &&
  app.includes('event.key === "Escape"') &&
  app.includes('event.key !== "Tab"'));

check("Conversation history uses validated cursor pagination and a deterministic index",
  server.includes("msg_pair_cursor") &&
  server.includes("to_char(created AT TIME ZONE") && server.includes("AS created") &&
  server.includes("ORDER BY created DESC,id DESC") &&
  server.includes("Invalid message-history cursor") &&
  app.includes("messageHistory") &&
  app.includes('loadMessages({ older: true })') &&
  app.includes('String(a.created).localeCompare(String(b.created))') &&
  app.includes("history.refreshPending = true") &&
  html.includes('id="loadOlderMessages"') &&
  html.includes('id="messageHistoryControl"'));

check("Voice-message reports explain that audio is not attached",
  app.includes("The audio itself is not attached to this report") &&
  html.includes("Voice-message audio is not attached"));

process.stdout.write("\nPinglet feature smoke-check completed successfully.\n");
