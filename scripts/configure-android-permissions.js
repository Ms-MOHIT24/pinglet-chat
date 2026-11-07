"use strict";
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.resolve(__dirname, "../android/app/src/main/AndroidManifest.xml");
if (!fs.existsSync(manifestPath)) throw new Error("Generated AndroidManifest.xml was not found.");
let manifest = fs.readFileSync(manifestPath, "utf8");
const marker = manifest.search(/<application\b/);
if (marker < 0) throw new Error("Could not find the Android application manifest section.");
const permissions = [
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS"
];
const declarations = permissions
  .filter(permission => !manifest.includes('android:name="' + permission + '"'))
  .map(permission => '    <uses-permission android:name="' + permission + '" />');
if (!manifest.includes('android:name="android.hardware.camera"')) {
  declarations.push('    <uses-feature android:name="android.hardware.camera" android:required="false" />');
}
if (!manifest.includes('android:name="android.hardware.microphone"')) {
  declarations.push('    <uses-feature android:name="android.hardware.microphone" android:required="false" />');
}
if (declarations.length) manifest = manifest.slice(0, marker) + declarations.join("\n") + "\n    " + manifest.slice(marker);
for (const permission of permissions) {
  if (!manifest.includes('android:name="' + permission + '"')) throw new Error("Missing Android permission: " + permission);
}
fs.writeFileSync(manifestPath, manifest);
process.stdout.write("Android camera and microphone permissions configured.\n");
