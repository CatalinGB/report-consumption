"use strict";

const assert = require("assert");
const schema = require("../js/schema.js");

const config = {
  v: 1,
  schema: 3,
  installation: "casa",
  houses: [
    { id: "house-a", name: "House A", order: 1, visible: false },
    { id: "house-b", name: "House B", order: 2, visible: true }
  ],
  meters: [
    { id: "electricity-a", name: "Electricitate House A", house_id: "house-a", visible: false, reading_mode: "manual" },
    { id: "gas-a", name: "Gaz House A", house_id: "house-a", visible: false, reading_mode: "manual", typical_by_month: { "01": 50, "02": 45, "03": 35, "04": 25, "05": 15, "06": 8, "07": 6, "08": 6, "09": 8, "10": 15, "11": 30, "12": 45 }, thresholds: { mode: "percent", warn_pct: 40, refuse_pct: 80 } },
    { id: "electricity-b", name: "Electricitate House B", house_id: "house-b", visible: true, reading_mode: "manual" }
  ]
};

assert.deepStrictEqual(schema.houses(config).map((h) => h.id), ["house-a", "house-b"]);
assert.strictEqual(schema.houseName(config, config.meters[0]), "House A");
assert.strictEqual(schema.houseName(config, config.meters[2]), "House B");

const visible = schema.visibleMeters(config);
assert.deepStrictEqual(visible.map((m) => m.id), ["electricity-b"]);

assert.strictEqual(schema.typicalForMonth(config.meters[1], "2026-01"), 50);
assert.strictEqual(schema.typicalForMonth(config.meters[1], "2026-08"), 6);
assert.strictEqual(schema.typicalForMonth({ typical_month: 4 }, "2026-10"), 4);
const mixedUnits = { unit: "m³", consumption_unit: "kWh", consumption_factor: 10.45, typical_month: 104.5 };
assert.strictEqual(schema.consumptionUnit(mixedUnits), "kWh");
assert.strictEqual(schema.consumptionFactor(mixedUnits), 10.45);
assert.strictEqual(schema.typicalForMonth(mixedUnits, "2026-10"), 104.5);
assert.ok(Math.abs(schema.typicalIndexForMonth(mixedUnits, "2026-10") - 10) < 1e-9);
assert.strictEqual(schema.typicalIndexForMonth({ unit: "m³", typical_month: 10 }, "2026-10"), 10);

const thresholds = schema.thresholdArgs(config.meters[1]);
assert.strictEqual(thresholds.thresholdMode, "percent");
assert.strictEqual(thresholds.warnPct, 40);
assert.strictEqual(thresholds.refusePct, 80);
const nullThresholds = schema.thresholdArgs({ thresholds: { mode: "absolute", warn_margin: null, refuse_margin: "" } });
assert.strictEqual(nullThresholds.warnDelta, 50);
assert.strictEqual(nullThresholds.refuseDelta, 100);

const grouped = schema.metersByHouse(config);
assert.strictEqual(grouped["house-a"].length, 2);
assert.strictEqual(grouped["house-b"].length, 1);

const migrated = schema.normalize({ meters: [{ id: "old-meter", reporting: "sensor", visible: true }] }, "casa");
assert.strictEqual(migrated.schema, 3);
assert.strictEqual(migrated.houses[0].id, "casa");
assert.strictEqual(migrated.meters[0].house_id, "casa");
assert.strictEqual(migrated.meters[0].reading_mode, "external");
assert.strictEqual(migrated.meters[0].notify, undefined);
assert.strictEqual(migrated.meters[0].forwarding, undefined);
assert.strictEqual(migrated.meters[0].consumption_factor, 1);

const submission = schema.buildSubmission({
  installation: "casa",
  meter: { id: "electricity-b", house_id: "house-b" },
  period: "2026-10",
  index: "4021",
  previous: { index: 4020, at: "2026-09-21T09:00:00Z" },
  submitted_by: "company_submitter",
  range_state: "ok"
});
assert.strictEqual(submission.meter_id, "electricity-b");
assert.strictEqual(submission.house_id, "house-b");
assert.strictEqual(submission.index, 4021);
assert.strictEqual(submission.previous_index, 4020);
assert.strictEqual(submission.delta, 1);
assert.strictEqual(submission.submitted_by, "company_submitter");
assert.strictEqual(submission.range_state, "ok");

assert.strictEqual(schema.validate(config), null);
assert.ok(schema.validate({ meters: [] }));
assert.ok(schema.validate({ ...config, houses: [] }));
assert.ok(schema.validate({ ...config, meters: [{ ...config.meters[2], house_id: "missing" }] }));
assert.ok(schema.validate({ ...config, meters: [{ ...config.meters[2], reading_mode: "smart" }] }));
assert.ok(schema.validate({ ...config, meters: [{ ...config.meters[2], consumption_factor: 0 }] }));

console.log("schema tests: all passed");
