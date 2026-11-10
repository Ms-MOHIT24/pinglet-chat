"use strict";

const net = require("node:net");

const TURN_URI_PATTERN = /^turns?:((?:\[[0-9a-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?))(?::([0-9]{1,5}))?(?:\?transport=(udp|tcp))?$/i;

function validDnsName(host) {
  if (host.length > 253) return false;
  const labels = host.split(".");
  return labels.every(label =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  );
}

function isValidTurnUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (value !== value.trim() || /\s/.test(value)) return false;

  const match = value.match(TURN_URI_PATTERN);
  if (!match) return false;

  const host = match[1];
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return false;

  if (host.startsWith("[")) {
    if (!host.endsWith("]") || net.isIP(host.slice(1, -1)) !== 6) return false;
  } else {
    const ipVersion = net.isIP(host);
    if (ipVersion !== 4 && !validDnsName(host)) return false;
    if (ipVersion === 0 && host.split(".").every(label => /^[0-9]+$/.test(label))) return false;
  }

  return true;
}

module.exports = { isValidTurnUrl };
