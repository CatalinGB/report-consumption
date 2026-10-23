/* Report Consumption — configuration schema helpers.
   Pure, dependency-free, usable in the browser and in Node tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RCSchema = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FALLBACK_HOUSE = { id: "casa", name: "Casa", order: 0, visible: true };

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? {} : value));
  }

  function asNumber(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function houses(config) {
    var list = config && Array.isArray(config.houses)
      ? config.houses.filter(function (house) { return house && typeof house === "object"; })
      : [];
    if (!list.length) return [clone(FALLBACK_HOUSE)];
    return list.slice().sort(function (a, b) {
      var ao = asNumber(a.order, 999);
      var bo = asNumber(b.order, 999);
      if (ao !== bo) return ao - bo;
      return String(a.name || a.id).localeCompare(String(b.name || b.id), "ro");
    });
  }

  function houseById(config, id) {
    var list = houses(config);
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function meterHouse(config, meter) {
    var id = (meter && meter.house_id) || FALLBACK_HOUSE.id;
    return houseById(config, id) || FALLBACK_HOUSE;
  }

  function houseName(config, meter) {
    var house = meterHouse(config, meter);
    return house ? (house.name || house.id) : "";
  }

  function visibleMeters(config) {
    var meters = config && Array.isArray(config.meters) ? config.meters : [];
    return meters.filter(function (meter) {
      if (!meter || meter.visible === false) return false;
      var house = meterHouse(config, meter);
      return !house || house.visible !== false;
    });
  }

  function allMeters(config) {
    return config && Array.isArray(config.meters) ? config.meters : [];
  }

  function metersByHouse(config) {
    var grouped = {};
    houses(config).forEach(function (house) {
      grouped[house.id] = [];
    });
    allMeters(config).forEach(function (meter) {
      if (!meter) return;
      var id = meter.house_id || FALLBACK_HOUSE.id;
      if (!grouped[id]) grouped[id] = [];
      grouped[id].push(meter);
    });
    return grouped;
  }

  function thresholdArgs(meter) {
    var thresholds = (meter && meter.thresholds) || {};
    var mode = thresholds.mode === "percent" ? "percent" : "absolute";
    return {
      thresholdMode: mode,
      warnDelta: asNumber(thresholds.warn_margin, 50),
      refuseDelta: asNumber(thresholds.refuse_margin, 100),
      warnPct: asNumber(thresholds.warn_pct, 40),
      refusePct: asNumber(thresholds.refuse_pct, 80)
    };
  }

  function typicalForMonth(meter, period) {
    if (!meter) return null;
    var profile = meter.typical_by_month;
    var month = period ? String(period).slice(5, 7) : null;
    if (profile && month) {
      var value = Array.isArray(profile) ? profile[Number(month) - 1] : profile[month];
      if (value !== null && value !== undefined && value !== "" && isFinite(Number(value))) {
        return Number(value);
      }
    }
    if (meter.typical_month !== null && meter.typical_month !== undefined && meter.typical_month !== "" && isFinite(Number(meter.typical_month))) {
      return Number(meter.typical_month);
    }
    return null;
  }

  function consumptionUnit(meter) {
    if (!meter) return "";
    return meter.consumption_unit || meter.unit || "";
  }

  function consumptionFactor(meter) {
    var factor = asNumber(meter && meter.consumption_factor, 1);
    return factor > 0 ? factor : 1;
  }

  // typical_month / typical_by_month are expressed in consumption_unit. The
  // anomaly model and expected index are always in the meter's index unit, so
  // convert with consumption_factor (consumption units per index unit).
  function typicalIndexForMonth(meter, period) {
    var typical = typicalForMonth(meter, period);
    if (typical === null) return null;
    return typical / consumptionFactor(meter);
  }

  function newId() {
    if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function buildSubmission(input) {
    var task = input || {};
    var meter = task.meter || {};
    var previous = task.previous || null;
    return {
      v: 1,
      id: task.id || newId(),
      installation: task.installation,
      house_id: meter.house_id || FALLBACK_HOUSE.id,
      meter_id: meter.id,
      period: task.period,
      index: Number(task.index),
      previous_index: previous ? Number(previous.index) : null,
      previous_at: previous ? previous.at : null,
      delta: previous ? Number(task.index) - Number(previous.index) : null,
      submitted_at: task.submitted_at || new Date().toISOString(),
      submitted_by: task.submitted_by || "index_submitter",
      range_state: task.range_state || null,
      photo: Boolean(task.photo),
      late: Boolean(task.late),
      corrected: Boolean(task.corrected),
      reset: Boolean(task.reset),
      client: task.client || {}
    };
  }

  function normalize(config, installation) {
    var out = clone(config);
    out.v = 1;
    out.schema = 3;
    out.installation = installation || out.installation || "casa";
    out.meters = Array.isArray(out.meters) ? out.meters.filter(function (m) { return m && typeof m === "object"; }) : [];
    out.houses = Array.isArray(out.houses)
      ? out.houses.filter(function (h) { return h && typeof h === "object"; })
      : [];
    if (!out.houses.length) out.houses = [clone(FALLBACK_HOUSE)];
    var known = {};
    out.houses.forEach(function (house) {
      if (!house || typeof house !== "object") return;
      delete house.address;
      if (house.id) known[house.id] = true;
    });
    out.meters.forEach(function (meter) {
      if (!meter.house_id || !known[meter.house_id]) meter.house_id = out.houses[0].id;
      if (meter.visible === undefined) meter.visible = true;

      // Schema 3 keeps only meter data in MQTT. Legacy HA orchestration
      // fields are migrated to reading_mode and then removed.
      var legacyMode = meter.reporting;
      if (!meter.reading_mode) {
        meter.reading_mode = (legacyMode === "smart" || legacyMode === "sensor")
          ? "external"
          : "manual";
      }
      delete meter.reporting;
      delete meter.notify;
      delete meter.source;
      delete meter.forwarding;

      if (Array.isArray(meter.typical_by_month)) {
        var profile = {};
        meter.typical_by_month.forEach(function (value, index) {
          profile[String(index + 1).padStart(2, "0")] = value;
        });
        meter.typical_by_month = profile;
      }

      meter.consumption_unit = meter.consumption_unit || meter.unit || "";
      meter.consumption_factor = meter.consumption_factor === null ||
        meter.consumption_factor === undefined || meter.consumption_factor === ""
        ? 1
        : meter.consumption_factor;
      meter.thresholds = meter.thresholds || { mode: "absolute", warn_margin: 50, refuse_margin: 100 };
    });
    delete out.notifications;
    return out;
  }

  function validate(config) {
    if (!config || !Array.isArray(config.meters) || !config.meters.length) {
      return "Adaugă cel puțin un contor.";
    }
    var housesList = houses(config);
    var houseIds = Object.create(null);
    for (var h = 0; h < housesList.length; h += 1) {
      var house = housesList[h];
      if (!house || !house.id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(house.id)) {
        return "ID de casă invalid la casa " + (h + 1) + ".";
      }
      if (houseIds[house.id]) return "ID de casă duplicat: " + house.id;
      houseIds[house.id] = true;
      if (!house.name || !String(house.name).trim()) return "Casa " + house.id + " nu are nume.";
    }
    var meterIds = Object.create(null);
    for (var i = 0; i < config.meters.length; i += 1) {
      var m = config.meters[i];
      if (!m || !m.id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(m.id)) return "ID invalid la contorul " + (i + 1) + " (litere mici, cifre, - și _).";
      if (meterIds[m.id]) return "ID duplicat: " + m.id;
      meterIds[m.id] = true;
      if (!m.name || !String(m.name).trim()) return "Contorul " + m.id + " nu are nume.";
      if (!houseIds[m.house_id]) return "Contorul " + m.id + " are o casă inexistentă.";
      if (m.reading_mode !== "manual" && m.reading_mode !== "external") {
        return "Modul de citire al contorului " + m.id + " este invalid.";
      }
      if (m.consumption_factor !== null && m.consumption_factor !== undefined && m.consumption_factor !== "") {
        var factor = Number(m.consumption_factor);
        if (!isFinite(factor) || factor <= 0) {
          return "Factorul de consum al contorului " + m.id + " trebuie să fie pozitiv.";
        }
      }
      if (m.typical_by_month) {
        var months = Array.isArray(m.typical_by_month) ? m.typical_by_month.length : Object.keys(m.typical_by_month).length;
        if (months !== 12) return "Profilul lunar al contorului " + m.id + " trebuie să aibă 12 valori.";
        var values = Array.isArray(m.typical_by_month) ? m.typical_by_month : Object.keys(m.typical_by_month).map(function (k) { return m.typical_by_month[k]; });
        for (var v = 0; v < values.length; v += 1) {
          if (values[v] !== null && values[v] !== "" && (!isFinite(Number(values[v])) || Number(values[v]) < 0)) {
            return "Profilul lunar al contorului " + m.id + " conține o valoare invalidă.";
          }
        }
      }
      var thresholds = m.thresholds || {};
      if (thresholds.mode === "percent") {
        if (!(Number(thresholds.warn_pct) > 0) || !(Number(thresholds.refuse_pct) >= Number(thresholds.warn_pct))) {
          return "Procentele de avertizare/refuz ale contorului " + m.id + " sunt invalide.";
        }
      }
    }
    return null;
  }

  return {
    FALLBACK_HOUSE: FALLBACK_HOUSE,
    houses: houses,
    houseById: houseById,
    meterHouse: meterHouse,
    houseName: houseName,
    visibleMeters: visibleMeters,
    allMeters: allMeters,
    metersByHouse: metersByHouse,
    thresholdArgs: thresholdArgs,
    typicalForMonth: typicalForMonth,
    consumptionUnit: consumptionUnit,
    consumptionFactor: consumptionFactor,
    typicalIndexForMonth: typicalIndexForMonth,
    buildSubmission: buildSubmission,
    normalize: normalize,
    validate: validate
  };
});
