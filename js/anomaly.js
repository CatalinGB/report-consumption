/* Report Consumption — expected-range and anomaly rules.
   Pure, dependency-free, usable in the browser and in Node tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RCAnomaly = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAYS_PER_MONTH = 30;
  var DEFAULT_WARN = 50;
  var DEFAULT_REFUSE = 100;

  function isNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function dayNumber(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return null;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000;
  }

  function daysBetween(from, to) {
    var a = dayNumber(from);
    var b = dayNumber(to);
    if (a === null || b === null) return null;
    return b - a;
  }

  function clampDelta(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    var n = Number(value);
    if (!isFinite(n) || n < 0) return fallback;
    return n;
  }

  /**
   * Evaluate an index against the baseline and typical consumption.
   *
   * @param {object} input
   * @param {number} input.index          the new index
   * @param {number|null} input.lastIndex the baseline index
   * @param {string|null} input.lastAt    when the baseline was read (ISO)
   * @param {number|null} input.typicalMonth typical consumption per 30 days
   * @param {number} [input.warnDelta]    absolute warning margin around expected
   * @param {number} [input.refuseDelta]  absolute refusal margin around expected
   * @param {"absolute"|"percent"} [input.thresholdMode]
   * @param {number} [input.warnPct]      percent warning margin (percent mode)
   * @param {number} [input.refusePct]    percent refusal margin (percent mode)
   * @param {Date|string} [input.now]     evaluation time
   * @param {boolean} [input.reset]       the reporter confirmed a meter reset
   */
  function evaluate(input) {
    input = input || {};

    var index = Number(input.index);
    var mode = input.thresholdMode === "percent" ? "percent" : "absolute";
    var warnDelta = clampDelta(input.warnDelta, DEFAULT_WARN);
    var refuseDelta = Math.max(clampDelta(input.refuseDelta, DEFAULT_REFUSE), warnDelta);
    var warnPct = clampDelta(input.warnPct, 40);
    var refusePct = Math.max(clampDelta(input.refusePct, 80), warnPct);
    var result = {
      state: "unknown",
      reason: null,
      available: false,
      reset: Boolean(input.reset),
      days: null,
      delta: null,
      expectedConsumption: null,
      expectedIndex: null,
      normalLow: null,
      normalHigh: null,
      refuseLow: null,
      refuseHigh: null,
      thresholdMode: mode,
      warnDelta: warnDelta,
      refuseDelta: refuseDelta,
      warnPct: warnPct,
      refusePct: refusePct
    };

    var hasBaseline = isNumber(Number(input.lastIndex)) && input.lastIndex !== null && input.lastIndex !== "";
    var lastIndex = hasBaseline ? Number(input.lastIndex) : null;

    if (!isFinite(index) || index < 0) {
      result.state = "invalid";
      result.reason = "negative";
      return result;
    }

    if (hasBaseline) {
      result.delta = index - lastIndex;
      if (index < lastIndex && !result.reset) {
        result.state = "rollover";
        result.reason = "below_baseline";
        return result;
      }
    }

    // A confirmed meter reset starts a new baseline; the old expected range
    // cannot be applied to the new counter.
    if (result.reset) {
      result.state = "ok";
      result.reason = "reset";
      result.available = false;
      return result;
    }

    var typical = Number(input.typicalMonth);
    var hasTypical = input.typicalMonth !== null && input.typicalMonth !== "" && isFinite(typical) && typical > 0;
    var days = input.lastAt ? daysBetween(input.lastAt, input.now || new Date()) : null;

    if (!hasBaseline || !hasTypical || days === null) {
      result.state = result.reset ? "ok" : "unknown";
      result.reason = result.reset ? "reset" : "no_baseline";
      return result;
    }

    days = Math.max(1, days);
    var expectedConsumption = typical * (days / DAYS_PER_MONTH);
    var expectedIndex = lastIndex + expectedConsumption;
    if (mode === "percent") {
      warnDelta = expectedConsumption * (warnPct / 100);
      refuseDelta = expectedConsumption * (refusePct / 100);
    }

    result.available = true;
    result.days = days;
    result.expectedConsumption = expectedConsumption;
    result.expectedIndex = expectedIndex;
    result.normalLow = expectedIndex - warnDelta;
    result.normalHigh = expectedIndex + warnDelta;
    result.refuseLow = expectedIndex - refuseDelta;
    result.refuseHigh = expectedIndex + refuseDelta;
    result.warnDelta = warnDelta;
    result.refuseDelta = refuseDelta;

    if (index < result.refuseLow) {
      result.state = "refuse";
      result.reason = "low";
    } else if (index > result.refuseHigh) {
      result.state = "refuse";
      result.reason = "high";
    } else if (index < result.normalLow) {
      result.state = "warn";
      result.reason = "low";
    } else if (index > result.normalHigh) {
      result.state = "warn";
      result.reason = "high";
    } else {
      result.state = "ok";
      result.reason = null;
    }

    return result;
  }

  return {
    evaluate: evaluate,
    daysBetween: daysBetween,
    DAYS_PER_MONTH: DAYS_PER_MONTH
  };
});
