#!/usr/bin/env node
"use strict";

/*
 * Compare the retained MQTT state with Home Assistant's discovery sensors.
 *
 * The app writes retained `meters/<installation>/last/<meter>` pointers. HA
 * mirrors them through `sensor.submission_<meter>` and
 * `sensor.meters_config`. If HA missed a retained message (for example after a
 * broker restart without persistence), the app and the company flow disagree
 * while everything still looks "connected". This check detects that.
 *
 * Usage:
 *   RC_HA_URL=http://homeassistant:8123 RC_HA_TOKEN=... node tools/healthcheck-state.js
 *
 * Optional:
 *   RC_INSTALLATION=casa
 *   RC_MQTT_URL=mqtts://mqtt.flespi.io:8883
 *
 * Exit codes: 0 in sync, 1 mismatch/missing state/connection error.
 */

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");

const ROOT = path.resolve(__dirname, "..");
const INSTALLATION = process.env.RC_INSTALLATION || "casa";
const MQTT_URL = process.env.RC_MQTT_URL || "mqtts://mqtt.flespi.io:8883";
const HA_URL = (process.env.RC_HA_URL || "").replace(/\/+$/, "");
const HA_TOKEN = process.env.RC_HA_TOKEN || "";
const TIMEOUT_MS = 12000;

function finish(code, message) {
  console.log(message);
  process.exit(code);
}

function readToken() {
  const text = fs.readFileSync(path.join(ROOT, ".env.tokens"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^REPORT_CONSUMPTION_HOME_TOKEN=(.*)$/);
    if (match) return match[1].trim();
  }
  throw new Error("REPORT_CONSUMPTION_HOME_TOKEN not found");
}

function haEntity(meterId) {
  return "sensor.submission_" + meterId.replace(/-/g, "_");
}

async function haState(entityId) {
  const response = await fetch(HA_URL + "/api/states/" + encodeURIComponent(entityId), {
    headers: { Authorization: "Bearer " + HA_TOKEN }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(entityId + ": HTTP " + response.status);
  return response.json();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return isFinite(number) ? number : null;
}

async function main() {
  if (!HA_URL || !HA_TOKEN) {
    finish(1, "state healthcheck: SKIP (set RC_HA_URL and RC_HA_TOKEN)");
  }

  const token = readToken();
  const client = mqtt.connect(MQTT_URL, {
    username: token,
    clientId: "rc-state-" + Math.random().toString(16).slice(2, 10),
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 15000
  });

  const last = {};
  const config = { value: null };
  let done = false;

  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    client.end(true);
    finish(1, "state healthcheck: FAIL (no retained state within 10s)");
  }, TIMEOUT_MS);

  client.on("connect", () => {
    client.subscribe("meters/" + INSTALLATION + "/last/+", { qos: 1 });
    client.subscribe("meters/" + INSTALLATION + "/config", { qos: 1 });
  });
  client.on("message", (topic, payload) => {
    const text = payload.toString();
    if (topic === "meters/" + INSTALLATION + "/config") {
      try { config.value = JSON.parse(text); } catch (_) { /* ignore */ }
      return;
    }
    const prefix = "meters/" + INSTALLATION + "/last/";
    if (topic.indexOf(prefix) !== 0) return;
    const meterId = topic.slice(prefix.length);
    if (!meterId || meterId.includes("/")) return;
    try {
      last[meterId] = JSON.parse(text);
    } catch (_) {
      last[meterId] = { invalid: true };
    }
  });
  client.on("error", (err) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    finish(1, "state healthcheck: FAIL (" + err.message + ")");
  });

  await new Promise((resolve) => setTimeout(resolve, 4000));
  if (done) return;
  done = true;
  clearTimeout(timer);
  client.end(true);

  const problems = [];
  for (const meterId of Object.keys(last).sort()) {
    const payload = last[meterId];
    if (!payload || payload.period === "reset") continue;
    if (payload.invalid) {
      problems.push(meterId + ": retained last payload is not JSON");
      continue;
    }
    const entity = await haState(haEntity(meterId));
    if (!entity) {
      problems.push(meterId + ": HA " + haEntity(meterId) + " is missing");
      continue;
    }
    const haPeriod = entity.state;
    const haIndex = numberOrNull(entity.attributes && entity.attributes.index);
    const mqttIndex = numberOrNull(payload.index);
    if (haPeriod !== payload.period) {
      problems.push(meterId + ": period MQTT=" + payload.period + " HA=" + haPeriod);
    }
    if (haIndex !== mqttIndex) {
      problems.push(meterId + ": index MQTT=" + mqttIndex + " HA=" + haIndex);
    }
    const statusEntity = await haState("sensor.company_status_" + meterId.replace(/-/g, "_"));
    if (statusEntity && statusEntity.attributes) {
      const statusPeriod = statusEntity.attributes.period;
      const statusIndex = numberOrNull(statusEntity.attributes.index);
      if (statusPeriod === payload.period && statusIndex !== null &&
          mqttIndex !== null && statusIndex !== mqttIndex) {
        problems.push(meterId + ": company status index " + statusIndex +
          " differs from last index " + mqttIndex + " for " + payload.period);
      }
    }
  }

  if (config.value) {
    const entity = await haState("sensor.meters_config");
    if (!entity) {
      problems.push("HA sensor.meters_config is missing");
    } else if (entity.state !== config.value.updated_at) {
      problems.push("config: MQTT updated_at=" + config.value.updated_at + " HA=" + entity.state);
    }
  }

  if (problems.length) {
    finish(1, "state healthcheck: FAIL\n- " + problems.join("\n- "));
  }
  finish(0, "state healthcheck: OK (MQTT and HA agree for " + Object.keys(last).length + " last pointer(s))");
}

main().catch((err) => finish(1, "state healthcheck: FAIL (" + err.message + ")"));
