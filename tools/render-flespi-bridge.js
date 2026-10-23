#!/usr/bin/env node
"use strict";

/*
 * Render the Flespi -> home Mosquitto bridge config with the real home token.
 * Reads .env.tokens (never prints it), writes ha/flespi-bridge.conf with mode
 * 600, and prints only the output path and the topic directions.
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tokensFile = path.join(root, ".env.tokens");
const exampleFile = path.join(root, "ha", "flespi-bridge.conf.example");
const outFile = path.join(root, "ha", "flespi-bridge.conf");

function readHomeToken() {
  const text = fs.readFileSync(tokensFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^REPORT_CONSUMPTION_HOME_TOKEN=(.*)$/);
    if (m) return m[1].trim();
  }
  throw new Error("REPORT_CONSUMPTION_HOME_TOKEN not found in .env.tokens");
}

const token = readHomeToken();
if (!token) throw new Error("home token is empty");

const rendered = fs.readFileSync(exampleFile, "utf8").replace("<HOME_TOKEN>", token);
fs.writeFileSync(outFile, rendered, { mode: 0o600 });
fs.chmodSync(outFile, 0o600);

console.log("wrote", outFile, "mode 600 (token not printed)");
console.log("copy it to the Mosquitto extensions directory (for example /path/to/mosquitto/config/extensions/flespi-bridge.conf)");
console.log("inside the container: /mosquitto/config/extensions/flespi-bridge.conf; chmod 644 and restart mosquitto");
console.log("directions: meters/casa/# in, meters/casa/status/# out");
