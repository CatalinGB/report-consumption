"use strict";

/* Repeatable browser + MQTT end-to-end test.
   Requires the local Aedes broker (tools/broker) and a static server:
     node tools/broker/server.js
     python3 -m http.server 8091
   Then: npm run e2e
*/

const assert = require("assert");
const mqtt = require("mqtt");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:8091/";
const BROKER = process.env.BROKER_URL || "ws://localhost:8083";
const MQTT_URL = process.env.MQTT_URL || "mqtts://localhost:8883";
const MQTT_USER = process.env.MQTT_USER || "report";
const INSTALLATION = process.env.INSTALLATION || "casa";

function connect() {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_URL, {
      username: MQTT_USER,
      rejectUnauthorized: false
    });
    client.once("connect", () => resolve(client));
    client.once("error", reject);
  });
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error("timeout: " + label));
      setTimeout(poll, 100);
    })();
  });
}

async function main() {
  const client = await connect();
  const last = {};
  const config = {};
  const event = {};

  client.on("message", (topic, payload) => {
    try {
      if (topic === "meters/" + INSTALLATION + "/last/elec-test") {
        last.value = JSON.parse(payload.toString());
      }
      if (topic === "meters/" + INSTALLATION + "/config") {
        config.value = JSON.parse(payload.toString());
      }
      if (topic === "meters/" + INSTALLATION + "/event/index") {
        event.value = JSON.parse(payload.toString());
      }
    } catch (err) {
      /* ignore malformed */
    }
  });
  client.subscribe("meters/" + INSTALLATION + "/last/elec-test", { qos: 1 });
  client.subscribe("meters/" + INSTALLATION + "/config", { qos: 1 });
  client.subscribe("meters/" + INSTALLATION + "/event/index", { qos: 1 });

  // Make the E2E self-contained: a 30-day-old baseline keeps the range stable
  // whenever the test is run.
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
      },
      {
        id: "water-test",
        name: "Apă test",
        kind: "water",
        provider: "Provider B",
        unit: "m³",
        precision: 3,
        visible: true,
        reading_mode: "manual",
        baseline: null,
        typical_month: 4,
        window: { type: "monthly", open_day: 28, open_time: "09:00", close_day: 2, close_time: "23:59" },
        thresholds: { warn_margin: 2, refuse_margin: 4 },
        photo: { enabled: true, max_kb: 512 }
      }
    ]
  };
  await new Promise((resolve, reject) => {
    client.publish(
      "meters/" + INSTALLATION + "/config",
      JSON.stringify(testConfig),
      { retain: true, qos: 1 },
      (err) => (err ? reject(err) : resolve())
    );
  });
  await new Promise((resolve) => setTimeout(resolve, 300));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const errors = [];

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("reporter: " + msg.text());
  });
  await page.goto(
    BASE + "#installation=" + encodeURIComponent(INSTALLATION) +
    "&token=" + encodeURIComponent(MQTT_USER) +
    "&broker=" + encodeURIComponent(BROKER)
  );
  await page.waitForSelector('[data-meter-id="elec-test"]', { timeout: 10000 });

  const hint = await page.textContent('[data-meter-id="elec-test"] [data-role="hint"]');
  assert(hint.includes("Așteptat"), "expected-range hint missing: " + hint);

  await page.fill('[data-meter-id="elec-test"] .index-input', "99999");
  assert(await page.isDisabled('[data-meter-id="elec-test"] .submit'), "refusal must disable submit");

  await page.fill('[data-meter-id="elec-test"] .index-input', "1240");
  assert(!(await page.isDisabled('[data-meter-id="elec-test"] .submit')), "valid value must enable submit");
  await page.click('[data-meter-id="elec-test"] .submit');
  await page.waitForFunction(
    () => document.getElementById("toast").textContent.includes("trimis"),
    { timeout: 10000 }
  );

  const published = await waitFor(
    () => (last.value && last.value.index === 1240 ? last.value : null),
    8000,
    "last/elec-test index 1240"
  );
  assert.strictEqual(published.photo, false, "no photo was attached");
  assert.strictEqual(typeof published.corrected, "boolean", "correction flag is present");
  const indexEvent = await waitFor(
    () => (event.value && event.value.index === 1240 ? event.value : null),
    8000,
    "event/index"
  );
  assert.strictEqual(indexEvent.submitted_by, "index_submitter", "new-index role");

  const admin = await context.newPage();
  admin.on("console", (msg) => {
    if (msg.type() === "error") errors.push("admin: " + msg.text());
  });
  await admin.goto(
    BASE + "admin.html#installation=" + encodeURIComponent(INSTALLATION) +
    "&token=" + encodeURIComponent(MQTT_USER) +
    "&broker=" + encodeURIComponent(BROKER)
  );
  await admin.click('[data-tab="configuration"]');
  await admin.waitForSelector('[data-meter-index="0"]', { timeout: 10000 });
  await admin.fill('[data-meter-index="0"] input[data-path="typical_month"]', "206");
  await admin.click("#save");
  await admin.waitForFunction(
    () => document.getElementById("save-status").textContent.includes("Publicat"),
    { timeout: 10000 }
  );
  await waitFor(
    () => (config.value && config.value.meters && config.value.meters[0].typical_month === 206 ? config.value : null),
    8000,
    "config typical 206"
  );

  assert.deepStrictEqual(errors, [], "browser console errors:\n" + errors.join("\n"));

  await browser.close();
  client.end(true);
  console.log("browser e2e: passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
