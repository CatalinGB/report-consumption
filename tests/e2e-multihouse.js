"use strict";

/* Local multi-house browser test: publishes config/seed.json to the test broker,
   then verifies the reporter sees only House B and the admin shows both houses
   and the gas Citiri form. Requires tools/broker and a static server, like e2e.
   Start the broker with MQTT_ALLOW_EMPTY_PASS=1: the browser connects with a
   token-as-username and no password, while the broker rejects empty passwords
   by default. */

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const mqtt = require("mqtt");
const { chromium } = require("playwright");
const RCAnomaly = require("../js/anomaly.js");
const RCSchema = require("../js/schema.js");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.BASE_URL || "http://localhost:8091/";
const BROKER = process.env.BROKER_URL || "ws://localhost:8083";
const MQTT_URL = process.env.MQTT_URL || "mqtts://localhost:8883";
const USER = process.env.MQTT_USER || "report";

function connect() {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_URL, {
      username: USER,
      rejectUnauthorized: false,
      reconnectPeriod: 0
    });
    client.once("connect", () => resolve(client));
    client.once("error", reject);
  });
}

function publish(client, topic, payload) {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 1, retain: true }, (err) => err ? reject(err) : resolve());
  });
}

function retained(client, topic, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener("message", onMessage);
      reject(new Error("timeout waiting for " + topic));
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

async function main() {
  const client = await connect();
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "seed.json"), "utf8"));
  seed.updated_at = new Date().toISOString();
  await publish(client, "meters/casa/config", JSON.stringify(seed));
  // The reset test leaves a retained reset marker under last/electricity-b;
  // clear it so a rerun observes only this run's submission.
  await publish(client, "meters/casa/last/electricity-b", "");

  // Derive a reading inside the normal band instead of hard-coding a value
  // that drifts out of the expected range as the calendar advances.
  const meter = seed.meters.find((item) => item.id === "electricity-b");
  assert(meter, "electricity-b in seed config");
  const typical = RCSchema.typicalForMonth(meter, null);
  const days = RCAnomaly.daysBetween(meter.baseline.at, new Date());
  assert(typical !== null && typical > 0, "electricity-b typical consumption");
  assert(days !== null, "electricity-b baseline date");
  const reading = Math.round(
    Number(meter.baseline.index) +
    typical * Math.max(1, days) / RCAnomaly.DAYS_PER_MONTH
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const errors = [];

  const reporter = await context.newPage();
  reporter.on("console", (msg) => {
    if (msg.type() === "error") errors.push("reporter: " + msg.text());
  });
  await reporter.goto(BASE + "#installation=casa&token=" + USER + "&broker=" + encodeURIComponent(BROKER));
  await reporter.waitForSelector('[data-meter-id="electricity-b"]', { timeout: 15000 });
  const meters = await reporter.$$eval("[data-meter-id]", (els) => els.map((el) => el.getAttribute("data-meter-id")));
  assert.deepStrictEqual(meters, ["electricity-b"], "reporter sees only House B");
  const house = await reporter.textContent(".house-group__head h2");
  assert.ok(house.includes("House B"), "House B house heading");

  const admin = await context.newPage();
  admin.on("console", (msg) => {
    if (msg.type() === "error") errors.push("admin: " + msg.text());
  });
  admin.on("dialog", (dialog) => {
    // Out-of-band readings ask for confirmation; accept so the submission
    // path is exercised instead of Playwright's default dismissal.
    if (dialog.type() === "confirm") dialog.accept().catch(() => {});
    else dialog.dismiss().catch(() => {});
  });
  await admin.goto(BASE + "admin.html#installation=casa&token=" + USER + "&broker=" + encodeURIComponent(BROKER));
  await admin.click('[data-tab="configuration"]');
  await admin.waitForSelector('#houses-editor [data-house-index="0"]', { timeout: 15000 });
  const houses = await admin.$$eval("#houses-editor [data-house-index]", (els) => els.length);
  assert.strictEqual(houses, 2, "two houses in admin");
  const citiri = await admin.$$eval("#citiri [data-citire-id]", (els) => els.map((el) => el.getAttribute("data-citire-id")));
  assert.ok(citiri.includes("gas-a"), "gas Citiri form");
  assert.ok(!citiri.includes("water-a"), "smart water excluded from Citiri");
  assert.deepStrictEqual(errors, [], "browser console errors");

  await admin.click('[data-tab="reporting"]');
  const lastPromise = retained(client, "meters/casa/last/electricity-b");
  await admin.fill('[data-citire-id="electricity-b"] .citire-input', String(reading));
  await admin.click('[data-citire-id="electricity-b"] .citire-submit');
  await admin.waitForFunction(() => document.getElementById("save-status").textContent.includes("publicată"), { timeout: 10000 });
  const last = JSON.parse(await lastPromise);
  assert.strictEqual(last.meter_id, "electricity-b", "admin Citiri meter");
  assert.strictEqual(last.index, reading, "admin Citiri index");
  assert.strictEqual(last.submitted_by, "company_submitter", "company submitter Citiri author");

  await admin.click("#history .retry-ha");
  await admin.waitForFunction(
    () => document.getElementById("save-status").textContent.includes("Preflight-ul HA"),
    { timeout: 10000 }
  );

  await admin.selectOption("#reset-meter", "electricity-b");
  await admin.click("#reset-reporting");
  await admin.waitForFunction(
    () => document.getElementById("reset-status").textContent.includes("Reset complet"),
    { timeout: 10000 }
  );
  const rowsAfterReset = await admin.$$eval("#history tbody tr", (els) => els.map((el) => el.textContent));
  assert.ok(!rowsAfterReset.some((row) => row.includes("Electricity B")), "reset clears the meter reporting history");
  const resetLast = JSON.parse(await retained(client, "meters/casa/last/electricity-b"));
  assert.strictEqual(resetLast.period, "reset", "reset marker period");
  assert.strictEqual(resetLast.reset, true, "reset marker flag");

  await browser.close();
  client.end(true);
  console.log("multi-house e2e: passed (reporter House B only; admin houses + gas Citiri; admin submission)");
}

main().catch((err) => {
  console.error("multi-house e2e failed:", err && err.message);
  process.exit(1);
});
