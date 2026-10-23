#!/usr/bin/env node
"use strict";

/*
 * MQTT -> ntfy.sh notifier.
 *
 * Home Assistant publishes a notification envelope to
 *   meters/<installation>/status/ntfy
 * through the normal Flespi bridge. This process subscribes to that topic and
 * forwards each envelope to the local ntfy topic.
 *
 * The ntfy topic and the Flespi home token stay in local, gitignored files.
 *
 * Usage:
 *   node tools/ntfy-listener.js
 *   RC_INSTALLATION=casa node tools/ntfy-listener.js
 */

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");
const { loadConfig, publish } = require("./ntfy");

const ROOT = path.resolve(__dirname, "..");
const INSTALLATION = process.env.RC_INSTALLATION || "casa";
const MQTT_URL = process.env.RC_MQTT_URL || "mqtts://mqtt.flespi.io:8883";
const TOPIC = "meters/" + INSTALLATION + "/status/ntfy";
const MAX_SEEN = 100;

function readToken() {
  const text = fs.readFileSync(path.join(ROOT, ".env.tokens"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^REPORT_CONSUMPTION_HOME_TOKEN=(.*)$/);
    if (match) return match[1].trim();
  }
  throw new Error("REPORT_CONSUMPTION_HOME_TOKEN not found in .env.tokens");
}

function clean(value) {
  return String(value == null ? "" : value).slice(0, 2000);
}

async function main() {
  loadConfig(); // fail fast if .env.ntfy is missing or malformed
  const seen = new Set();
  const token = readToken();
  const client = mqtt.connect(MQTT_URL, {
    username: token,
    clientId: "rc-ntfy-" + Math.random().toString(16).slice(2, 10),
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 15000
  });

  client.on("connect", () => {
    console.log("ntfy listener: connected; waiting for " + TOPIC);
    client.subscribe(TOPIC, { qos: 1 }, (err) => {
      if (err) console.error("ntfy listener: subscribe failed: " + err.message);
    });
  });

  client.on("reconnect", () => console.log("ntfy listener: reconnecting"));
  client.on("error", (err) => console.error("ntfy listener: " + err.message));

  client.on("message", (topic, payload, packet) => {
    if (topic !== TOPIC) return;
    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch (err) {
      console.error("ntfy listener: ignoring non-JSON notification");
      return;
    }
    if (!data || data.v !== 1 || !data.message) {
      console.error("ntfy listener: ignoring notification without v=1/message");
      return;
    }

    // A retained envelope is only useful while it is fresh; otherwise a
    // restart would replay an old notification.
    if (packet.retain) {
      const at = Date.parse(data.at);
      if (!isFinite(at) || Date.now() - at > 10 * 60 * 1000) return;
    }

    const key = [data.at, data.title, data.message].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > MAX_SEEN) {
      const oldest = seen.values().next().value;
      seen.delete(oldest);
    }

    publish({
      title: clean(data.title || "Report consumption"),
      message: clean(data.message),
      priority: clean(data.priority || "default"),
      tags: clean(data.tags || "bell"),
      url: clean(data.url || ""),
      actionLabel: clean(data.action_label || "Open link")
    })
      .then(() => console.log("ntfy listener: sent " + clean(data.title || "notification")))
      .catch((err) => console.error("ntfy listener: send failed: " + err.message));
  });

  const shutdown = () => {
    client.end(true, () => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("ntfy listener: " + err.message);
  process.exit(1);
});
