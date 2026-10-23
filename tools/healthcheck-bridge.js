#!/usr/bin/env node
"use strict";

/*
 * End-to-end bridge healthcheck.
 *
 * Home Assistant publishes meters/casa/status/ha-heartbeat every 5 minutes.
 * The Mosquitto bridge forwards it to Flespi. This script reads the retained
 * heartbeat from Flespi; a stale, future, or missing value means the
 * HA -> bridge -> Flespi path is broken.
 *
 * Usage:
 *   node tools/healthcheck-bridge.js
 *   RC_HEARTBEAT_MAX_AGE=1200 node tools/healthcheck-bridge.js
 *
 * RC_HEARTBEAT_MAX_AGE must be a positive number of seconds (default 900).
 * RC_HEARTBEAT_REQUIRE_BY defaults to requiring data.by == "ha"; set it to 0
 * only for a heartbeat producer that does not send that field.
 *
 * Exit codes: 0 fresh, 1 stale/missing/connection error.
 */

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");

const ROOT = path.resolve(__dirname, "..");
const INSTALLATION = process.env.RC_INSTALLATION || "casa";
const MQTT_URL = process.env.RC_MQTT_URL || "mqtts://mqtt.flespi.io:8883";
const REQUIRE_BY = process.env.RC_HEARTBEAT_REQUIRE_BY !== "0";
const TOPIC = "meters/" + INSTALLATION + "/status/ha-heartbeat";

function readToken() {
  const text = fs.readFileSync(path.join(ROOT, ".env.tokens"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^REPORT_CONSUMPTION_HOME_TOKEN=(.*)$/);
    if (m) return m[1].trim();
  }
  throw new Error("REPORT_CONSUMPTION_HOME_TOKEN not found");
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

function finish(code, message) {
  console.log(message);
  process.exit(code);
}

try {
  const maxAge = readPositiveNumber("RC_HEARTBEAT_MAX_AGE", 900);
  const token = readToken();
  const client = mqtt.connect(MQTT_URL, {
    username: token,
    clientId: "rc-health-" + Math.random().toString(16).slice(2, 10),
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 15000
  });
  let done = false;
  const timeout = setTimeout(() => {
    if (done) return;
    done = true;
    client.end(true);
    finish(1, "bridge healthcheck: FAIL (no heartbeat within 10s)");
  }, 10000);

  client.on("connect", () => client.subscribe(TOPIC, { qos: 1 }));
  client.on("message", (topic, payload) => {
    if (topic !== TOPIC || done) return;
    done = true;
    clearTimeout(timeout);
    client.end(true);
    let data;
    try { data = JSON.parse(payload.toString()); } catch (err) {
      finish(1, "bridge healthcheck: FAIL (heartbeat is not JSON)");
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      finish(1, "bridge healthcheck: FAIL (heartbeat is not a JSON object)");
      return;
    }
    if (REQUIRE_BY && data.by !== "ha") {
      finish(1, "bridge healthcheck: FAIL (heartbeat source is not 'ha')");
      return;
    }
    const at = Date.parse(data.at);
    if (!isFinite(at)) return finish(1, "bridge healthcheck: FAIL (heartbeat has no valid at)");
    const now = Date.now();
    if (at > now) {
      return finish(1, "bridge healthcheck: FAIL (heartbeat timestamp is in the future)");
    }
    const age = Math.round((now - at) / 1000);
    if (age > maxAge) return finish(1, "bridge healthcheck: FAIL (heartbeat age " + age + "s > " + maxAge + "s)");
    finish(0, "bridge healthcheck: OK (heartbeat age " + age + "s)");
  });
  client.on("error", (err) => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    finish(1, "bridge healthcheck: FAIL (" + err.message + ")");
  });
} catch (err) {
  finish(1, "bridge healthcheck: FAIL (" + err.message + ")");
}
