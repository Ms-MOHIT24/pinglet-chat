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

const output = [
  '"use strict";',
  "window.PINGLET_CONFIG = Object.freeze({ apiOrigin: " + JSON.stringify(apiOrigin) + " });",
  ""
].join("\n");

const destination = path.join(__dirname, "..", "public", "runtime-config.js");
fs.writeFileSync(destination, output, { encoding: "utf8", mode: 0o644 });
process.stdout.write("Configured Pinglet runtime API origin: " + (apiOrigin || "(browser same-origin / native production default)") + "\n");
