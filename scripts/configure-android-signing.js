"use strict";
const fs = require("node:fs");
const path = require("node:path");

const gradlePath = path.resolve(__dirname, "../android/app/build.gradle");
if (!fs.existsSync(gradlePath)) throw new Error("Generated Android app/build.gradle was not found.");
const required = ["ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"];
for (const name of required) {
  if (!process.env[name]) throw new Error("Missing signing environment variable: " + name);
}
let gradle = fs.readFileSync(gradlePath, "utf8");
if (!/\bbuildTypes\s*\{/.test(gradle)) throw new Error("Could not find Android buildTypes block.");
if (!/\bdefaultConfig\s*\{/.test(gradle)) throw new Error("Could not find Android defaultConfig block.");
if (!/upload-key\.jks/.test(gradle)) {
  const signing = `
    signingConfigs {
        release {
            storeFile file("upload-key.jks")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
`;
  gradle = gradle.replace(/(\n\s*)buildTypes\s*\{/, "$1" + signing + "$1buildTypes {");
}
gradle = gradle.replace(/(release\s*\{)/, "$1\n            signingConfig signingConfigs.release");
gradle = gradle.replace(/versionCode\s+\d+/, "versionCode 10900");
gradle = gradle.replace(/versionName\s+["'][^"']+["']/, 'versionName "1.9.0"');
if (!/signingConfig\s+signingConfigs\.release/.test(gradle)) throw new Error("Release signing config was not attached.");
if (!/versionCode\s+10900/.test(gradle) || !/versionName\s+"1\.9\.0"/.test(gradle)) throw new Error("Android version metadata was not set.");
fs.writeFileSync(gradlePath, gradle);
process.stdout.write("Android release signing config applied (keystore file contents are not printed).\n");
