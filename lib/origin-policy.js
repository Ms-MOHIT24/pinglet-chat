"use strict";

const NATIVE_ORIGINS = Object.freeze([
  "capacitor://localhost",
  "ionic://localhost",
  "https://localhost",
  "http://localhost"
]);

function configuredHttpsOrigin(environment) {
  const explicitPublicUrl = typeof environment.PUBLIC_URL === "string"
    ? environment.PUBLIC_URL.trim()
    : "";
  const renderExternalUrl = typeof environment.RENDER_EXTERNAL_URL === "string"
    ? environment.RENDER_EXTERNAL_URL.trim()
    : "";
  const value = explicitPublicUrl || renderExternalUrl;
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return null;

    return url.origin;
  } catch {
    return null;
  }
}

function createOriginPolicy(environment = process.env) {
  const publicOrigin = configuredHttpsOrigin(environment);
  const allowedOrigins = new Set(NATIVE_ORIGINS);
  const connectSrc = ["'self'"];

  if (publicOrigin) {
    const url = new URL(publicOrigin);
    allowedOrigins.add(publicOrigin);
    connectSrc.push(publicOrigin, `wss://${url.host}`);
  }

  return {
    publicOrigin,
    allowedOrigins,
    connectSrc: Object.freeze(connectSrc)
  };
}

module.exports = { createOriginPolicy };
