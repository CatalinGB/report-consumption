"use strict";

const assert = require("assert");
const period = require("../js/period.js");

const crossMonth = {
  open_day: 28,
  open_time: "09:00",
  close_day: 2,
  close_time: "23:59"
};
const sameMonth = {
  open_day: 21,
  open_time: "09:00",
  close_day: 25,
  close_time: "23:59"
};

const submitted = (periods) => (p) => periods.indexOf(p) >= 0;
const none = () => false;

// 28th -> 2nd window, no previous submission: late for September on Oct 17.
let s = period.state(crossMonth, new Date(2026, 9, 17, 12, 0), none);
assert.strictEqual(s.period, "2026-09");
assert.strictEqual(s.state, "late");

// Previous period was submitted: wait for the next window.
s = period.state(crossMonth, new Date(2026, 9, 17, 12, 0), submitted(["2026-09"]));
assert.strictEqual(s.period, "2026-10");
assert.strictEqual(s.state, "upcoming");

// Inside the cross-month window (Oct 29 / Nov 1), period is October.
s = period.state(crossMonth, new Date(2026, 9, 29, 12, 0), none);
assert.strictEqual(s.period, "2026-10");
assert.strictEqual(s.state, "open");
s = period.state(crossMonth, new Date(2026, 10, 1, 12, 0), none);
assert.strictEqual(s.period, "2026-10");
assert.strictEqual(s.state, "open");

// After the window closes: late for October.
s = period.state(crossMonth, new Date(2026, 10, 3, 12, 0), none);
assert.strictEqual(s.period, "2026-10");
assert.strictEqual(s.state, "late");

// Already reported the current period.
s = period.state(crossMonth, new Date(2026, 10, 1, 12, 0), submitted(["2026-10"]));
assert.strictEqual(s.period, "2026-10");
assert.strictEqual(s.state, "reported");

// Same-month window: Oct 17 waits for Oct after a reported September.
s = period.state(sameMonth, new Date(2026, 9, 17, 12, 0), submitted(["2026-09"]));
assert.strictEqual(s.period, "2026-10");
assert.strictEqual(s.state, "upcoming");

// Same-month window open on Oct 22.
s = period.state(sameMonth, new Date(2026, 9, 22, 12, 0), none);
assert.strictEqual(s.period, "2026-10");
assert.strictEqual(s.state, "open");

// Same-month window closed on Oct 26: late.
s = period.state(sameMonth, new Date(2026, 9, 26, 12, 0), none);
assert.strictEqual(s.period, "2026-10");
assert.strictEqual(s.state, "late");

// No window: always open for the current month.
s = period.state(null, new Date(2026, 9, 17, 12, 0), none);
assert.strictEqual(s.period, "2026-10");
assert.strictEqual(s.state, "open");
assert.strictEqual(s.opensAt, null);

// Day 31 is clamped to the actual month end instead of rolling into March.
const day31 = { open_day: 1, open_time: "09:00", close_day: 31, close_time: "23:59" };
const feb = period.forMonth(day31, 2026, 1);
assert.strictEqual(feb.close.getMonth(), 1);
assert.strictEqual(feb.close.getDate(), 28);
assert.strictEqual(period.forPeriod(day31, "2026-02").close.getDate(), 28);

// Config timezone is honored even when the device timezone differs.
const utcLate = new Date("2026-10-31T22:30:00Z");
const zoned = period.state(null, utcLate, none, "Europe/Bucharest");
assert.strictEqual(zoned.period, "2026-11");

console.log("period tests: all passed");
