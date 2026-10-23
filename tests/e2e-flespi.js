"use strict";

/* Production-path E2E: real Flespi broker + a deployed Pages app.
   Reads scoped tokens from .env.tokens (never prints them), backs up the current
   retained config, publishes a temporary test config, drives the public
   reporter/admin pages, asserts retained topics through the home token, then
   restores the exact config it found. The restore also runs on failures and on
   SIGINT/SIGTERM. */

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const mqtt = require("mqtt");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.BASE_URL || "http://localhost:8091/";
const MQTT_URL = "mqtts://mqtt.flespi.io:8883";
const INSTALLATION = "casa";
const CONFIG_TOPIC = "meters/" + INSTALLATION + "/config";
const LAST_TOPIC = "meters/" + INSTALLATION + "/last/elec-test";
const secrets = [];

let tokens = null;
let admin = null;
let home = null;
let browser = null;
let originalConfig = null;
let lastRecord = null;
let cleanupPromise = null;
let interrupted = false;

function readTokens() {
  const text = fs.readFileSync(path.join(ROOT, ".env.tokens"), "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  assert(out.REPORT_CONSUMPTION_REPORTER_TOKEN, "reporter token missing");
  assert(out.REPORT_CONSUMPTION_ADMIN_TOKEN, "admin token missing");
  assert(out.REPORT_CONSUMPTION_HOME_TOKEN, "home token missing");
  for (const value of [out.REPORT_CONSUMPTION_REPORTER_TOKEN, out.REPORT_CONSUMPTION_ADMIN_TOKEN, out.REPORT_CONSUMPTION_HOME_TOKEN]) {
    if (value) secrets.push(value);
  }
  return out;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_URL, {
      username: token,
      clientId: "rc-e2e-" + Math.random().toString(16).slice(2, 10),
      connectTimeout: 15000,
      reconnectPeriod: 0
    });
    client.once("connect", () => resolve(client));
    client.once("error", reject);
  });
}

function publish(client, topic, payload, retain = true) {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 1, retain }, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

function retained(client, topic, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener("message", onMessage);
      reject(new Error("timeout waiting for retained topic"));
    }, timeoutMs);
    function onMessage(incoming, payload) {
      if (incoming !== topic) return;
      clearTimeout(timer);
      client.removeListener("message", onMessage);
      resolve(payload.toString());
    }
    client.on("message", onMessage);
    client.subscribe(topic, { qos: 1 });
  });
}

async function ensureClient(current, token, label, failures) {
  if (current && current.connected) return current;
  if (current) {
    try { current.end(true); } catch (_) { /* already closed */ }
  }
  if (!token) return null;
  try {
    return await connect(token);
  } catch (err) {
    failures.push("reconnect " + label + ": " + redact(err && err.message));
    return null;
  }
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const failures = [];

    home = await ensureClient(home, tokens && tokens.REPORT_CONSUMPTION_HOME_TOKEN, "home", failures);
    admin = await ensureClient(admin, tokens && tokens.REPORT_CONSUMPTION_ADMIN_TOKEN, "admin", failures);

    let period = lastRecord && lastRecord.period ? lastRecord.period : null;
    if (!period && home) {
      try {
        const raw = await retained(home, LAST_TOPIC, 2000);
        const parsed = JSON.parse(raw);
        if (parsed && parsed.period) period = parsed.period;
      } catch (_) { /* no test submission retained */ }
    }
    if (!period) {
      // window:null meters report for the browser's local month (js/period.js).
      const now = new Date();
      period = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    }

    if (admin) {
      const topics = [LAST_TOPIC];
      if (period) {
        topics.push("meters/" + INSTALLATION + "/submission/elec-test/" + period);
        topics.push("meters/" + INSTALLATION + "/photo/elec-test/" + period);
      }
      for (const topic of topics) {
        try {
          await publish(admin, topic, "", true);
        } catch (err) {
          failures.push("clear " + topic + ": " + redact(err && err.message));
        }
      }
      if (originalConfig !== null) {
        try {
          await publish(admin, CONFIG_TOPIC, originalConfig, true);
        } catch (err) {
          failures.push("restore config: " + redact(err && err.message));
        }
      }
    } else if (originalConfig !== null) {
      failures.push("admin client unavailable; original config was not restored");
    }

    if (browser) {
      try { await browser.close(); } catch (err) { failures.push("close browser: " + redact(err && err.message)); }
      browser = null;
    }
    if (admin) { admin.end(true); admin = null; }
    if (home) { home.end(true); home = null; }

    for (const failure of failures) console.error("flespi e2e cleanup: " + failure);
    return failures;
  })();
  return cleanupPromise;
}

function handleSignal(signal) {
  if (interrupted) return;
  interrupted = true;
  console.error("flespi e2e interrupted (" + signal + "); restoring the original config...");
  cleanup().then((failures) => {
    for (const failure of failures) console.error("flespi e2e cleanup: " + failure);
    process.exit(1);
  }).catch((err) => {
    console.error("flespi e2e cleanup failed:", redact(err && err.message));
    process.exit(1);
  });
}

process.once("SIGINT", () => handleSignal("SIGINT"));
process.once("SIGTERM", () => handleSignal("SIGTERM"));

async function main() {
  tokens = readTokens();
  admin = await connect(tokens.REPORT_CONSUMPTION_ADMIN_TOKEN);
  home = await connect(tokens.REPORT_CONSUMPTION_HOME_TOKEN);

  const baselineAt = new Date(Date.now() - 30 * 86400000).toISOString();
  const testConfig = {
    v: 1,
    schema: 3,
    installation: INSTALLATION,
    updated_at: new Date().toISOString(),
    timezone: "Europe/Bucharest",
    locale: "ro",
    meters: [
      {
        id: "elec-test",
        name: "Electricitate test",
        kind: "electricity",
        provider: "Provider A",
        unit: "kWh",
        precision: 0,
        visible: true,
        reading_mode: "manual",
        baseline: { index: 1000, at: baselineAt },
        typical_month: 200,
        window: null,
        thresholds: { warn_margin: 50, refuse_margin: 100 },
        photo: { enabled: true, max_kb: 512 }
      }
    ]
  };

  originalConfig = await retained(home, CONFIG_TOPIC);

  let failure = null;
  let cleanupFailures = [];
  try {
    await publish(admin, CONFIG_TOPIC, JSON.stringify(testConfig));

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const errors = [];

    const reporter = await context.newPage();
    reporter.on("console", (msg) => {
      if (msg.type() === "error") errors.push("reporter: " + msg.text());
    });
    await reporter.goto(
      BASE + "#installation=" + encodeURIComponent(INSTALLATION) +
      "&token=" + encodeURIComponent(tokens.REPORT_CONSUMPTION_REPORTER_TOKEN)
    );
    await reporter.waitForSelector('[data-meter-id="elec-test"]', { timeout: 20000 });
    const hint = await reporter.textContent('[data-meter-id="elec-test"] [data-role="hint"]');
    assert(hint.includes("Așteptat"), "expected-range hint missing");

    await reporter.fill('[data-meter-id="elec-test"] .index-input', "99999");
    assert(await reporter.isDisabled('[data-meter-id="elec-test"] .submit'), "refusal must disable submit");

    await reporter.fill('[data-meter-id="elec-test"] .index-input', "1240");
    await reporter.setInputFiles(
      '[data-meter-id="elec-test"] .photo-input',
      path.join(ROOT, "tests", "fixtures", "meter.jpg")
    );
    await reporter.waitForSelector('[data-meter-id="elec-test"] .photo-preview__img', { timeout: 15000 });
    await reporter.click('[data-meter-id="elec-test"] .submit');
    await reporter.waitForFunction(
      () => document.getElementById("toast").textContent.includes("trimis"),
      { timeout: 15000 }
    );

    const lastRaw = await retained(home, LAST_TOPIC);
    const last = JSON.parse(lastRaw);
    lastRecord = last;
    assert.strictEqual(last.index, 1240, "retained last index");
    assert.strictEqual(last.photo, true, "photo uploaded");
    const photo = await retained(home, "meters/" + INSTALLATION + "/photo/elec-test/" + last.period);
    assert(photo.length > 1000, "retained photo payload");

    const adminPage = await context.newPage();
    adminPage.on("console", (msg) => {
      if (msg.type() === "error") errors.push("admin: " + msg.text());
    });
    await adminPage.goto(
      BASE + "admin.html#installation=" + encodeURIComponent(INSTALLATION) +
      "&token=" + encodeURIComponent(tokens.REPORT_CONSUMPTION_ADMIN_TOKEN)
    );
    await adminPage.click('[data-tab="configuration"]');
    await adminPage.waitForSelector('[data-meter-index="0"]', { timeout: 20000 });
    await adminPage.fill('[data-meter-index="0"] input[data-path="typical_month"]', "206");
    await adminPage.click("#save");
    await adminPage.waitForFunction(
      () => document.getElementById("save-status").textContent.includes("Publicat"),
      { timeout: 15000 }
    );
    const configRaw = await retained(home, CONFIG_TOPIC);
    assert.strictEqual(JSON.parse(configRaw).meters[0].typical_month, 206, "admin publish");

    assert.deepStrictEqual(errors, [], "browser console errors:\n" + errors.join("\n"));
  } catch (err) {
    failure = err;
  } finally {
    try {
      cleanupFailures = await cleanup();
    } catch (err) {
      cleanupFailures = ["cleanup failed: " + (err && err.message)];
    }
  }

  if (interrupted) throw new Error("interrupted by signal");
  if (failure) throw failure;
  if (cleanupFailures.length) throw new Error("cleanup incomplete: " + cleanupFailures.join("; "));
  console.log("flespi e2e: passed (test artifacts removed, original config restored)");
}

function redact(message) {
  let text = String(message || "");
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  return text;
}

main().catch((err) => {
  console.error("flespi e2e failed:", redact(err && err.message));
  process.exit(1);
});
