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
  html.includes('id="topGames" href="/games"') &&
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
check("Service-worker cache version is current",
  /CACHE_NAME = "pinglet-shell-v9"/.test(sw));

process.stdout.write("\nPinglet feature smoke-check completed successfully.\n");
