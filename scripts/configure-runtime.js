"use strict";

const fs = require("node:fs");
const path = require("node:path");

const raw = (process.env.PINGLET_API_ORIGIN || "").trim();
let apiOrigin = "";

if (raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("PINGLET_API_ORIGIN must be a valid HTTPS origin.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash ||
      !["pinglet-chat-live.onrender.com", "pinglet-chat-staging.onrender.com"].includes(parsed.hostname)) {
    throw new Error("PINGLET_API_ORIGIN must be the HTTPS origin of Pinglet production or staging.");
  }
  apiOrigin = parsed.origin;
}

// Android serves its bundled UI from Capacitor rather than receiving the
// server's Helmet header. Generate a matching, exact-origin CSP for that build.
// An empty input retains the existing production API default.
const effectiveApiOrigin = apiOrigin || "https://pinglet-chat-live.onrender.com";
const apiUrl = new URL(effectiveApiOrigin);
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  \`connect-src 'self' \${effectiveApiOrigin} wss://\${apiUrl.host}\`,
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

const output = [
  '"use strict";',
  "window.PINGLET_CONFIG = Object.freeze({ apiOrigin: " + JSON.stringify(apiOrigin) + " });",
  ""
].join("\\n");

const publicDir = path.join(__dirname, "..", "public");
const runtimeConfigPath = path.join(publicDir, "runtime-config.js");
const htmlPath = path.join(publicDir, "index.html");
fs.writeFileSync(runtimeConfigPath, output, { encoding: "utf8", mode: 0o644 });

let html = fs.readFileSync(htmlPath, "utf8");
const cspTag = '<meta http-equiv="Content-Security-Policy" content="' + contentSecurityPolicy + '">';
const cspMetaPattern = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i;
if (cspMetaPattern.test(html)) {
  html = html.replace(cspMetaPattern, cspTag);
} else {
  const titlePattern = /<title\b/i;
  if (!titlePattern.test(html)) throw new Error("Could not insert the native Content Security Policy.");
  html = html.replace(titlePattern, cspTag + "\n<title");
}
fs.writeFileSync(htmlPath, html, "utf8");

process.stdout.write("Configured Pinglet runtime API origin: " +
  (apiOrigin || "(native production default)") + "\n");
