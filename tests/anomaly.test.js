"use strict";

const assert = require("assert");
const anomaly = require("../js/anomaly.js");

const now = new Date("2026-10-17T12:00:00Z");
const lastAt = "2026-09-17T12:00:00Z"; // 30 days

function run(index, extra) {
  return anomaly.evaluate(Object.assign({
    index: index,
    lastIndex: 1000,
    lastAt: lastAt,
    typicalMonth: 200,
    warnDelta: 50,
    refuseDelta: 100,
    now: now
  }, extra || {}));
}

// Baseline example from the owner: 1000, +200 typical, warn 50, refuse 100.
let r = run(1200);
assert.strictEqual(r.state, "ok");
assert.strictEqual(r.expectedIndex, 1200);
assert.strictEqual(r.normalLow, 1150);
assert.strictEqual(r.normalHigh, 1250);
assert.strictEqual(r.refuseLow, 1100);
assert.strictEqual(r.refuseHigh, 1300);

assert.strictEqual(run(1150).state, "ok");
assert.strictEqual(run(1250).state, "ok");
assert.strictEqual(run(1149).state, "warn");
assert.strictEqual(run(1251).state, "warn");
assert.strictEqual(run(1100).state, "warn");
assert.strictEqual(run(1300).state, "warn");
assert.strictEqual(run(1099).state, "refuse");
assert.strictEqual(run(1301).state, "refuse");

// A meter reset is not a normal consumption.
r = run(999);
assert.strictEqual(r.state, "rollover");
r = run(999, { reset: true });
assert.strictEqual(r.state, "ok");
assert.strictEqual(r.reset, true);

// No baseline: the first reading is accepted, no range.
r = anomaly.evaluate({ index: 42, lastIndex: null, lastAt: null, typicalMonth: 4, now: now });
assert.strictEqual(r.state, "unknown");
assert.strictEqual(r.available, false);

// No typical consumption: range unavailable, reading still possible.
r = anomaly.evaluate({ index: 42, lastIndex: 10, lastAt: lastAt, typicalMonth: null, now: now });
assert.strictEqual(r.state, "unknown");
assert.strictEqual(r.available, false);

// Proration: half a month at 200 means ~100 expected.
r = anomaly.evaluate({
  index: 1100,
  lastIndex: 1000,
  lastAt: "2026-10-02T12:00:00Z",
  typicalMonth: 200,
  warnDelta: 50,
  refuseDelta: 100,
  now: now
});
assert.strictEqual(r.days, 15);
assert.strictEqual(r.expectedConsumption, 100);
assert.strictEqual(r.expectedIndex, 1100);
assert.strictEqual(r.state, "ok");

// Same-day reading: at least one day of expected consumption.
r = anomaly.evaluate({
  index: 1010,
  lastIndex: 1000,
  lastAt: "2026-10-17T08:00:00Z",
  typicalMonth: 200,
  warnDelta: 50,
  refuseDelta: 100,
  now: now
});
assert.strictEqual(r.days, 1);
assert.ok(r.expectedConsumption > 6 && r.expectedConsumption < 7);

// Water: 4 m³ typical, warn 2, refuse 4, three decimals.
r = anomaly.evaluate({
  index: 4.2,
  lastIndex: 0,
  lastAt: lastAt,
  typicalMonth: 4,
  warnDelta: 2,
  refuseDelta: 4,
  now: now
});
assert.strictEqual(r.state, "ok");
assert.strictEqual(r.normalLow, 2);
assert.strictEqual(r.normalHigh, 6);
assert.strictEqual(r.refuseLow, 0);
assert.strictEqual(r.refuseHigh, 8);

r = anomaly.evaluate({
  index: 8.001,
  lastIndex: 0,
  lastAt: lastAt,
  typicalMonth: 4,
  warnDelta: 2,
  refuseDelta: 4,
  now: now
});
assert.strictEqual(r.state, "refuse");
assert.strictEqual(r.reason, "high");

// Gas uses a monthly profile plus percentage margins. 52 m³ expected,
// 40% warn and 80% refuse => normal 31.2–72.8, refuse outside 10.4–93.6.
r = anomaly.evaluate({
  index: 1052,
  lastIndex: 1000,
  lastAt: lastAt,
  typicalMonth: 52,
  thresholdMode: "percent",
  warnPct: 40,
  refusePct: 80,
  now: now
});
assert.strictEqual(r.state, "ok");
assert.strictEqual(r.expectedIndex, 1052);
assert.strictEqual(r.warnDelta, 20.8);
assert.strictEqual(r.refuseDelta, 41.6);
assert.strictEqual(r.normalLow, 1031.2);
assert.strictEqual(r.normalHigh, 1072.8);
assert.strictEqual(r.refuseLow, 1010.4);
assert.strictEqual(r.refuseHigh, 1093.6);

r = anomaly.evaluate({
  index: 1073,
  lastIndex: 1000,
  lastAt: lastAt,
  typicalMonth: 52,
  thresholdMode: "percent",
  warnPct: 40,
  refusePct: 80,
  now: now
});
assert.strictEqual(r.state, "warn");

r = anomaly.evaluate({
  index: 1094,
  lastIndex: 1000,
  lastAt: lastAt,
  typicalMonth: 52,
  thresholdMode: "percent",
  warnPct: 40,
  refusePct: 80,
  now: now
});
assert.strictEqual(r.state, "refuse");

// Negative values are invalid.
r = anomaly.evaluate({ index: -1, lastIndex: 1000, lastAt: lastAt, typicalMonth: 200, now: now });
assert.strictEqual(r.state, "invalid");

// Refuse delta can never be smaller than the warn delta.
r = anomaly.evaluate({
  index: 1260,
  lastIndex: 1000,
  lastAt: lastAt,
  typicalMonth: 200,
  warnDelta: 50,
  refuseDelta: 10,
  now: now
});
assert.strictEqual(r.refuseDelta, 50);
assert.strictEqual(r.state, "refuse");

console.log("anomaly tests: all passed");
