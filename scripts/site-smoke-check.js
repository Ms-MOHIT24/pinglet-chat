"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const site = path.join(root, "site");
const read = name => fs.readFileSync(path.join(site, name), "utf8");
const exists = name => fs.existsSync(path.join(site, name));

const html = read("index.html");
const script = read("script.js");
const config = read("release-config.js");
const privacy = read("privacy-safety.html");
const css = read("styles.css");
const configuredDownloadUrl = (config.match(/downloadUrl\\s*:\\s*"([^"]*)"/) || [])[1] || "";

const checks = [
  ["landing page has a page title and responsive viewport", /<title>Pinglet/.test(html) && /name="viewport"/.test(html)],
  ["all local front-end assets exist", ["styles.css", "script.js", "release-config.js", "privacy-safety.html"].every(exists)],
  ["landing page loads the expected local scripts and stylesheet", html.includes('href="styles.css"') && html.includes('src="release-config.js"') && html.includes('src="script.js"')],
  ["mobile navigation has accessible labels and state", html.includes('aria-label="Main navigation"') && html.includes('aria-expanded="false"')],
  ["public launch status and privacy/safety page are linked", html.includes("PUBLIC LAUNCH STATUS") && html.includes('href="privacy-safety.html"')],
  ["website does not collect credentials or offer account registration", !/<form\\b|<input\\b|type="password"|name="password"/i.test(html)],
  ["website has no remote font or analytics dependency", !/fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|googletagmanager|google-analytics/i.test(html + script)],
  ["Android download remains disabled until an approved URL is added", config.includes('downloadUrl: ""') && html.includes('id="android-download"') && html.includes("button-disabled")],
  ["download link only accepts HTTPS APK assets from the Pinglet release path", script.includes('url.protocol==="https:"') && script.includes('url.hostname==="github.com"') && script.includes('/Ms-MOHIT24/pinglet-chat/releases/download/') && script.includes('.apk')],
  ["preview/debug APK is not configured as the public download", !/app-debug\\.apk|android-latest/i.test(configuredDownloadUrl)],
  ["privacy page clearly says it is informational and not a final app privacy policy", privacy.includes("informational website") && privacy.includes("not a complete privacy notice for the Pinglet app")],
  ["policy page has dedicated responsive styles", css.includes(".policy-shell") && css.includes(".policy-page") && css.includes("@media(max-width:600px)")]
];

for (const [label, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", label);
    process.exitCode = 1;
  } else {
    console.log("PASS:", label);
  }
}

if (process.exitCode) {
  console.error("Website smoke checks failed.");
} else {
  console.log("All " + checks.length + " website smoke checks passed.");
}
