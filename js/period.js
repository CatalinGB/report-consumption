/* Report Consumption — reporting window and period logic.
   Pure, dependency-free, usable in the browser and in Node tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RCPeriod = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function monthKey(year, monthIndex) {
    var d = new Date(year, monthIndex, 1);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1);
  }

  function parseTime(value, fallback) {
    var text = value || fallback || "00:00";
    var parts = String(text).split(":");
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (!isFinite(h) || h < 0 || h > 23) h = 0;
    if (!isFinite(m) || m < 0 || m > 59) m = 0;
    return { h: h, m: m };
  }

  function monthEnd(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function zonedNow(now, timeZone) {
    if (!timeZone) return now;
    try {
      var parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(now);
      var values = {};
      parts.forEach(function (part) { values[part.type] = part.value; });
      return new Date(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second)
      );
    } catch (err) {
      return now;
    }
  }

  function at(year, monthIndex, day, time) {
    var t = parseTime(time, "00:00");
    var clamped = Math.min(Math.max(Number(day) || 1, 1), monthEnd(year, monthIndex));
    return new Date(year, monthIndex, clamped, t.h, t.m, 0, 0);
  }

  function forMonth(window, year, monthIndex) {
    var open = at(year, monthIndex, window.open_day, window.open_time || "00:00");
    var closeMonth = window.close_day < window.open_day ? monthIndex + 1 : monthIndex;
    var close = at(year, closeMonth, window.close_day, window.close_time || "23:59");
    return {
      period: monthKey(year, monthIndex),
      open: open,
      close: close
    };
  }

  function forPeriod(window, period) {
    if (!window || !period) return null;
    var parts = String(period).split("-");
    if (parts.length !== 2) return null;
    var year = Number(parts[0]);
    var month = Number(parts[1]) - 1;
    if (!isFinite(year) || !isFinite(month) || month < 0 || month > 11) return null;
    return forMonth(window, year, month);
  }

  /**
   * Decide the period the reporter should submit for now.
   *
   * @param {object|null} window  the meter window ({open_day, open_time, close_day, close_time})
   * @param {Date} [now]
   * @param {function(string):boolean} [hasSubmission]  period -> already reported?
   */
  function state(window, now, hasSubmission, timeZone) {
    now = zonedNow(now || new Date(), timeZone);
    var check = typeof hasSubmission === "function" ? hasSubmission : function () { return false; };

    if (!window || !window.open_day || !window.close_day) {
      var current = monthKey(now.getFullYear(), now.getMonth());
      var reportedNow = check(current);
      return {
        period: current,
        state: reportedNow ? "reported" : "open",
        reported: reportedNow,
        opensAt: null,
        closesAt: null,
        late: false,
        upcoming: false
      };
    }

    var year = now.getFullYear();
    var month = now.getMonth();
    var currentWindow = forMonth(window, year, month);
    var previousWindow = forMonth(window, year, month - 1);
    var chosen = null;

    if (now >= previousWindow.open && now <= previousWindow.close) {
      // A window that crossed the month boundary is still open for the previous period.
      chosen = previousWindow;
    } else if (now >= currentWindow.open && now <= currentWindow.close) {
      chosen = currentWindow;
    } else if (now > currentWindow.close) {
      // The current window has closed; late submission for the current period.
      chosen = currentWindow;
    } else if (now > previousWindow.close && now < currentWindow.open) {
      // Between windows: either late for the previous period or waiting for this one.
      chosen = check(previousWindow.period) ? currentWindow : previousWindow;
    } else {
      chosen = currentWindow;
    }

    var reported = check(chosen.period);
    var resultState;
    if (now < chosen.open) resultState = "upcoming";
    else if (now > chosen.close) resultState = "late";
    else resultState = "open";
    if (reported) resultState = "reported";

    return {
      period: chosen.period,
      state: resultState,
      reported: reported,
      opensAt: chosen.open,
      closesAt: chosen.close,
      late: now > chosen.close,
      upcoming: now < chosen.open
    };
  }

  return {
    state: state,
    forMonth: forMonth,
    forPeriod: forPeriod,
    monthKey: monthKey
  };
});
