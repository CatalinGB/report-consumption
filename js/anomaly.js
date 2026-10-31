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

  function parsePeriod(period) {
    if (typeof period !== "string" || !/^\d{4}-\d{2}$/.test(period)) return null;
    var year = Number(period.slice(0, 4));
    var month = Number(period.slice(5, 7));
    if (!isFinite(year) || !isFinite(month) || month < 1 || month > 12) return null;
    return { year: year, month: month, index: year * 12 + (month - 1) };
  }

  /**
   * Whole calendar months between two `YYYY-MM` periods. Returns null when
   * either value is not a valid period.
   */
  function monthsBetween(from, to) {
    var a = parsePeriod(from);
    var b = parsePeriod(to);
    if (!a || !b) return null;
    return b.index - a.index;
  }

  function clampDelta(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    var n = Number(value);
    if (!isFinite(n) || n < 0) return fallback;
    return n;
  }

  /**
   * Compute the expected range without evaluating a particular index.
   *
   * The preferred model for monthly meters is period-based: the expected
   * consumption between period P-1 and P is one typical month, regardless of
   * when the submissions were made. Day-proration is kept as a fallback for
   * meters without a reporting window and for legacy callers.
   *
   * @param {object} input
   * @param {number|null} input.lastIndex baseline index
   * @param {string|null} input.lastAt when the baseline was read (ISO)
   * @param {number|null} input.typicalMonth typical consumption per month
   * @param {string|null} [input.period] current YYYY-MM period
   * @param {string|null} [input.lastPeriod] baseline YYYY-MM period
   * @param {boolean} [input.requireBaselinePeriod] strict monthly mode
   * @param {boolean} [input.requireBaselineDate] strict day mode
   * @param {Date|string} [input.now]
   * @param {"absolute"|"percent"} [input.thresholdMode]
   * @param {number} [input.warnDelta]
   * @param {number} [input.refuseDelta]
   * @param {number} [input.warnPct]
   * @param {number} [input.refusePct]
   */
  function expectedRange(input) {
    input = input || {};

    var mode = input.thresholdMode === "percent" ? "percent" : "absolute";
    var warnDelta = clampDelta(input.warnDelta, DEFAULT_WARN);
    var refuseDelta = Math.max(clampDelta(input.refuseDelta, DEFAULT_REFUSE), warnDelta);
    var warnPct = clampDelta(input.warnPct, 40);
    var refusePct = Math.max(clampDelta(input.refusePct, 80), warnPct);
    var result = {
      available: false,
      configError: false,
      reason: null,
      period: parsePeriod(input.period) ? input.period : null,
      lastPeriod: parsePeriod(input.lastPeriod) ? input.lastPeriod : null,
      months: null,
      days: null,
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
    var typical = Number(input.typicalMonth);
    var hasTypical = input.typicalMonth !== null && input.typicalMonth !== undefined &&
      input.typicalMonth !== "" && isFinite(typical) && typical > 0;

    if (!hasBaseline) {
      result.reason = "no_baseline";
      return result;
    }
    if (!hasTypical) {
      result.reason = "no_typical";
      return result;
    }

    var months = null;
    var days = null;

    if (result.period && result.lastPeriod) {
      months = monthsBetween(result.lastPeriod, result.period);
      if (months === null || months <= 0) {
        result.reason = "period_order";
        result.configError = Boolean(input.requireBaselinePeriod);
        return result;
      }
    } else if (input.lastAt) {
      days = daysBetween(input.lastAt, input.now || new Date());
      if (days === null) {
        result.reason = "baseline_date_invalid";
        result.configError = Boolean(input.requireBaselineDate);
        return result;
      }
      if (days < 0) {
        result.reason = "baseline_date_future";
        result.configError = true;
        return result;
      }
      days = Math.max(1, days);
    } else {
      result.reason = "baseline_period_missing";
      result.configError = Boolean(input.requireBaselinePeriod || input.requireBaselineDate);
      return result;
    }

    var expectedConsumption = months !== null
      ? typical * months
      : typical * (days / DAYS_PER_MONTH);
    var expectedIndex = lastIndex + expectedConsumption;
    if (mode === "percent") {
      warnDelta = expectedConsumption * (warnPct / 100);
      refuseDelta = expectedConsumption * (refusePct / 100);
    }

    result.available = true;
    result.months = months;
    result.days = months !== null ? months * DAYS_PER_MONTH : days;
    result.expectedConsumption = expectedConsumption;
    result.expectedIndex = expectedIndex;
    result.normalLow = expectedIndex - warnDelta;
    result.normalHigh = expectedIndex + warnDelta;
    result.refuseLow = expectedIndex - refuseDelta;
    result.refuseHigh = expectedIndex + refuseDelta;
    result.warnDelta = warnDelta;
    result.refuseDelta = refuseDelta;
    return result;
  }

  /**
   * Evaluate an index against the baseline and typical consumption.
   *
   * @param {object} input
   * @param {number} input.index          the new index
   * @param {number|null} input.lastIndex the baseline index
   * @param {string|null} input.lastAt    when the baseline was read (ISO)
   * @param {number|null} input.typicalMonth typical consumption per month
   * @param {string|null} [input.period]  current YYYY-MM period
   * @param {string|null} [input.lastPeriod] baseline YYYY-MM period
   * @param {boolean} [input.requireBaselinePeriod] strict monthly mode
   * @param {boolean} [input.requireBaselineDate] strict day mode
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
    var result = expectedRange(input);
    result.state = "unknown";
    result.reason = result.reason || null;
    result.reset = Boolean(input.reset);
    result.delta = null;
    result.configError = Boolean(result.configError);

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
      result.configError = false;
      return result;
    }

    if (!result.available) {
      if (result.configError) {
        result.state = "config_error";
      } else {
        result.state = "unknown";
      }
      return result;
    }

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
    expectedRange: expectedRange,
    daysBetween: daysBetween,
    monthsBetween: monthsBetween,
    parsePeriod: parsePeriod,
    DAYS_PER_MONTH: DAYS_PER_MONTH
  };
});
