"use strict";

/* Monthly-period regression for the reporter.
   Covers the live failure mode: a late catch-up reading was booked as the
   current month, then the real monthly reading looked like a three-day spike.
   Requires the local broker and static server, like the other e2e tests. */

const assert = require("assert");
const mqtt = require("mqtt");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:8091/";
const BROKER = process.env.BROKER_URL || "ws://localhost:8083";
const MQTT_URL = process.env.MQTT_URL || "mqtts://localhost:8883";
const MQTT_USER = process.env.MQTT_USER || "report";
const INSTALLATION = process.env.INSTALLATION || "casa";
const METER = "elec-periods";

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

function publish(client, topic, payload) {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 1, retain: true }, (err) => err ? reject(err) : resolve());
  });
}

function baseConfig(updatedAt, baseline) {
  return {
    v: 1,
    schema: 3,
    installation: INSTALLATION,
    updated_at: updatedAt,
    timezone: "Europe/Bucharest",
    locale: "ro",
    houses: [{ id: "house-b", name: "House B", order: 1, visible: true }],
    meters: [{
      id: METER,
      house_id: "house-b",
      name: "Electricitate perioade",
      kind: "electricity",
      provider: "Provider A",
      unit: "kWh",
      precision: 0,
      visible: true,
      reading_mode: "manual",
      baseline: baseline,
      typical_month: 220,
      window: { type: "monthly", open_day: 4, open_time: "09:00", close_day: 5, close_time: "23:59" },
      thresholds: { mode: "absolute", warn_margin: 50, refuse_margin: 100 },
      photo: { enabled: false, max_kb: 512 }
    }]
  };
}

function submission(period, index, submittedAt) {
  return JSON.stringify({
    v: 1,
    id: "periods-" + period,
    installation: INSTALLATION,
    house_id: "house-b",
    meter_id: METER,
    period: period,
    index: index,
    previous_index: index - 220,
    previous_at: "2026-08-23T09:00:00Z",
    previous_period: "2026-08",
    delta: 220,
    submitted_at: submittedAt,
    submitted_by: "index_submitter",
    range_state: "ok",
    photo: false,
    late: true,
    corrected: false,
    reset: false,
    client: { tz: "Europe/Bucharest", ua: "periods-test" }
  });
}

async function openReporter(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(
    BASE + "#installation=" + encodeURIComponent(INSTALLATION) +
    "&token=" + encodeURIComponent(MQTT_USER) +
    "&broker=" + encodeURIComponent(BROKER)
  );
  await page.waitForSelector('[data-meter-id="' + METER + '"]', { timeout: 10000 });
  return { context, page, errors };
}

async function main() {
  const client = await connect();
  const prefix = "meters/" + INSTALLATION;

  // 1. A previous-period submission makes the current reading a normal month.
  await publish(client, prefix + "/submission/" + METER + "/2026-10", "");
  await publish(client, prefix + "/status/" + METER + "/2026-10", "");
  await publish(client, prefix + "/last/" + METER, "");
  await publish(client, prefix + "/submission/" + METER + "/2026-09", submission("2026-09", 1000, "2026-09-23T09:00:00Z"));
  await publish(client, prefix + "/config", JSON.stringify(baseConfig(
    new Date().toISOString(),
    { index: 800, at: "2026-08-23T09:00:00Z", period: "2026-08" }
  )));
  await new Promise((resolve) => setTimeout(resolve, 400));

  const browser = await chromium.launch({ headless: true });
  let opened = await openReporter(browser);
  let page = opened.page;

  const hint = await page.textContent('[data-meter-id="' + METER + '"] [data-role="hint"]');
  assert(hint.includes("Așteptat"), "expected range hint: " + hint);
  assert(/1[.,]220/.test(hint), "expected 1220 from 1000 + 220: " + hint);
  await page.fill('[data-meter-id="' + METER + '"] .index-input', "1220");
  assert(!(await page.isDisabled('[data-meter-id="' + METER + '"] .submit')), "one-month reading must be submittable");
  await page.click('[data-meter-id="' + METER + '"] .submit');
  await page.waitForFunction(
    () => document.getElementById("toast").textContent.includes("trimis"),
    { timeout: 10000 }
  );
  const published = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("last pointer timeout")), 8000);
    function onMessage(topic, payload) {
      if (topic !== prefix + "/last/" + METER) return;
      const parsed = JSON.parse(payload.toString());
      if (parsed.index !== 1220) return;
      clearTimeout(timer);
      client.removeListener("message", onMessage);
      resolve(parsed);
    }
    client.on("message", onMessage);
    client.subscribe(prefix + "/last/" + METER, { qos: 1 });
  });
  assert.strictEqual(published.previous_period, "2026-09", "previous period is the September submission");
  assert.strictEqual(published.range.months, 1, "expected range uses one month");
  assert.strictEqual(published.range.state, "ok", "1220 is ok over one month");
  assert.deepStrictEqual(opened.errors, [], "reporter console errors:\n" + opened.errors.join("\n"));

  // 2. A baseline in the same period as the report is a config error, not a
  // three-day range.
  await opened.context.close();
  await publish(client, prefix + "/submission/" + METER + "/2026-09", "");
  await publish(client, prefix + "/submission/" + METER + "/2026-10", "");
  await publish(client, prefix + "/last/" + METER, "");
  await publish(client, prefix + "/config", JSON.stringify(baseConfig(
    new Date(Date.now() + 1000).toISOString(),
    { index: 1000, at: "2026-10-23T09:00:00Z", period: "2026-10" }
  )));
  await new Promise((resolve) => setTimeout(resolve, 400));

  opened = await openReporter(browser);
  page = opened.page;
  await page.fill('[data-meter-id="' + METER + '"] .index-input', "1220");
  assert(await page.isDisabled('[data-meter-id="' + METER + '"] .submit'), "config error must disable submit");
  const errorHint = await page.textContent('[data-meter-id="' + METER + '"] [data-role="hint"]');
  assert(errorHint.includes("Citirea de bază") || errorHint.includes("Configurație incompletă"),
    "config error hint: " + errorHint);
  assert.deepStrictEqual(opened.errors, [], "reporter console errors (config error):\n" + opened.errors.join("\n"));
  await opened.context.close();

  // 3. Late current + unreported previous offers the period selector and
  // defaults to the previous (catch-up) period.
  await publish(client, prefix + "/submission/" + METER + "/2026-09", "");
  await publish(client, prefix + "/submission/" + METER + "/2026-10", "");
  await publish(client, prefix + "/last/" + METER, "");
  const lateConfig = baseConfig(
    new Date(Date.now() + 2000).toISOString(),
    { index: 800, at: "2026-08-23T09:00:00Z", period: "2026-08" }
  );
  lateConfig.meters[0].window = { type: "monthly", open_day: 20, open_time: "09:00", close_day: 21, close_time: "23:59" };
  await publish(client, prefix + "/config", JSON.stringify(lateConfig));
  await new Promise((resolve) => setTimeout(resolve, 400));

  opened = await openReporter(browser);
  page = opened.page;
  const selector = await page.$('[data-meter-id="' + METER + '"] .period-select');
  assert(selector, "period selector appears when the previous period is unreported");
  assert.strictEqual(await selector.inputValue(), "2026-09", "defaults to the earlier unreported period");
  const options = await page.$$eval('[data-meter-id="' + METER + '"] .period-select option', (els) => els.map((el) => el.value));
  assert(options.includes("2026-09") && options.includes("2026-10"), "selector lists both periods: " + options.join(","));
  assert.deepStrictEqual(opened.errors, [], "reporter console errors (selector):\n" + opened.errors.join("\n"));

  await opened.context.close();

  // 4. A meter activated on 1 Oct with no index must not walk back to
  // September just because September is also unreported.
  await publish(client, prefix + "/submission/" + METER + "/2026-09", "");
  await publish(client, prefix + "/submission/" + METER + "/2026-10", "");
  await publish(client, prefix + "/last/" + METER, "");
  const startConfig = baseConfig(
    new Date(Date.now() + 3000).toISOString(),
    { at: "2026-10-01T09:00:00Z" }
  );
  startConfig.meters[0].typical_month = 4;
  startConfig.meters[0].window = { type: "monthly", open_day: 11, open_time: "09:00", close_day: 12, close_time: "23:59" };
  await publish(client, prefix + "/config", JSON.stringify(startConfig));
  await new Promise((resolve) => setTimeout(resolve, 400));

  opened = await openReporter(browser);
  page = opened.page;
  const periodText = await page.textContent('[data-meter-id="' + METER + '"] .stat:nth-child(3) .stat__value');
  assert(periodText.includes("octombrie"), "start date must floor the period at October: " + periodText);
  assert(!periodText.includes("septembrie"), "period must not walk back before the start date: " + periodText);
  assert.strictEqual(await page.$('[data-meter-id="' + METER + '"] .period-select'), null,
    "no earlier period selector before the meter start date");
  assert.deepStrictEqual(opened.errors, [], "reporter console errors (start floor):\n" + opened.errors.join("\n"));

  await opened.context.close();
  await browser.close();
  client.end(true);
  console.log("period regression e2e: passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
