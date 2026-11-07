"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vendorDir = path.join(root, "public", "vendor");
const assets = [
  {
    source: path.join(root, "node_modules", "socket.io", "client-dist", "socket.io.js"),
    target: path.join(vendorDir, "socket.io.js")
  },
  {
    source: path.join(root, "node_modules", "jsqr", "dist", "jsQR.js"),
    target: path.join(vendorDir, "jsQR.js")
  }
];
fs.mkdirSync(vendorDir, { recursive: true });
for (const asset of assets) {
  if (!fs.existsSync(asset.source)) {
    throw new Error("Required browser runtime is missing: " + path.relative(root, asset.source) + ". Run npm install first.");
  }
  fs.copyFileSync(asset.source, asset.target);
  process.stdout.write("Bundled " + path.basename(asset.target) + "\n");
}
