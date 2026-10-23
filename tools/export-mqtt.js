#!/usr/bin/env node
"use strict";

/*
 * Export every retained topic under meters/<installation>/# into a local JSON
 * backup. Uses the home token (subscribe-only, no browser origin).
 *
 * Usage:
 *   node tools/export-mqtt.js
 *   RC_INSTALLATION=demo RC_BACKUP_DIR="$HOME/backups/report-consumption" \
 *     node tools/export-mqtt.js
 *
 * The file contains readings and optional photos. It is written with mode 600
 * and the backup directory with mode 700. Never commit it.
 */

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");

const ROOT = path.resolve(__dirname, "..");
const BACKUP_DIR = process.env.RC_BACKUP_DIR || path.join(ROOT, "backups");
const MQTT_URL = process.env.RC_MQTT_URL || "mqtts://mqtt.flespi.io:8883";

function readToken() {
  const text = fs.readFileSync(path.join(ROOT, ".env.tokens"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^REPORT_CONSUMPTION_HOME_TOKEN=(.*)$/);
    if (m) return m[1].trim();
  }
  throw new Error("REPORT_CONSUMPTION_HOME_TOKEN not found in .env.tokens");
}

function readPositiveNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!isFinite(value) || value <= 0) {
    throw new Error(name + " must be a positive number");
  }
  return value;
}

function readInstallation() {
  const value = process.env.RC_INSTALLATION || "casa";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("RC_INSTALLATION must be a safe slug ([A-Za-z0-9_-], starting alphanumeric)");
  }
  return value;
}

function writeAtomic(file, text) {
  const tmp = file + ".tmp-" + process.pid + "-" + Math.random().toString(16).slice(2, 8);
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch (_) { /* best effort */ }
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
    throw err;
  }
}

function main() {
  const installation = readInstallation();
  const quietMs = readPositiveNumber("RC_BACKUP_QUIET_MS", 2500);
  const maxMs = readPositiveNumber("RC_BACKUP_MAX_MS", 20000);
  const token = readToken();
  if (!token) throw new Error("home token is empty");
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(BACKUP_DIR, 0o700); } catch (_) { /* best effort */ }

  const topics = {};
  const started = Date.now();
  let lastMessage = Date.now();
  let finished = false;
  let timer = null;
  let deadline = null;

  const client = mqtt.connect(MQTT_URL, {
    username: token,
    clientId: "rc-export-" + Math.random().toString(16).slice(2, 10),
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 15000
  });

  function finish(err) {
    if (finished) return;
    finished = true;
    if (timer) clearInterval(timer);
    if (deadline) clearTimeout(deadline);
    client.end(true);
    if (err) {
      console.error("backup failed:", err.message);
      process.exitCode = 1;
      return;
    }
    const count = Object.keys(topics).length;
    if (!count) {
      console.error("backup failed: no retained topics collected under meters/" + installation + "/#");
      process.exitCode = 1;
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = path.join(BACKUP_DIR, "report-consumption-" + installation + "-" + stamp + ".json");
    const body = {
      exported_at: new Date().toISOString(),
      installation: installation,
      topic_count: count,
      topics
    };
    try {
      writeAtomic(out, JSON.stringify(body, null, 2));
    } catch (writeErr) {
      console.error("backup failed:", writeErr.message);
      process.exitCode = 1;
      return;
    }
    console.log("wrote", out, "mode 600;", count, "retained topics");
  }

  client.on("connect", () => {
    client.subscribe("meters/" + installation + "/#", { qos: 1 }, (err) => {
      if (err) return finish(err);
    });
  });

  client.on("message", (topic, payload) => {
    if (!topic.startsWith("meters/" + installation + "/")) return;
    topics[topic] = payload.toString();
    lastMessage = Date.now();
  });

  client.on("error", (err) => finish(err));
  client.on("close", () => finish(new Error("connection closed before the backup finished")));
  client.on("offline", () => finish(new Error("connection went offline before the backup finished")));

  timer = setInterval(() => {
    const now = Date.now();
    if (now - started >= maxMs || (Object.keys(topics).length && now - lastMessage >= quietMs)) {
      finish(null);
    }
  }, 250);

  deadline = setTimeout(() => {
    finish(new Error("timed out waiting for retained topics"));
  }, maxMs + 5000);
  deadline.unref();
}

try {
  main();
} catch (err) {
  console.error("backup failed:", err.message);
  process.exit(1);
}
