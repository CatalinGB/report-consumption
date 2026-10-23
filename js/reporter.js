/* Reporter page — full flow.
   Reads the retained config, computes the window and expected range, validates
   the index, prepares an optional photo, publishes to MQTT and queues offline. */
(function () {
  "use strict";

  var params = RC.parseParams();
  var token = params.token || localStorage.getItem("rc.reporter.token") || "";
  var installation = params.installation || localStorage.getItem("rc.installation") || RC.DEFAULTS.installation;
  var broker = params.broker || localStorage.getItem("rc.broker") || RC.DEFAULTS.broker;

  if (params.token || params.installation || params.broker) {
    if (params.token) localStorage.setItem("rc.reporter.token", params.token);
    if (params.installation) localStorage.setItem("rc.installation", params.installation);
    if (params.broker) localStorage.setItem("rc.broker", params.broker);
    RC.stripUrl();
  }

  var setup = RC.$("setup");
  var waiting = RC.$("waiting");
  var metersEl = RC.$("meters");
  var fatal = RC.$("fatal");
  var conn = RC.$("conn");
  var waitingDetail = RC.$("waiting-detail");
  var installationLabel = RC.$("installation-label");
  var toastEl = RC.$("toast");

  var config = null;
  var submissions = {};
  var drafts = {};
  var photoDrafts = {};
  var connected = false;
  var client = null;
  var flushing = false;
  var toastTimer = null;

  RC.applyI18n();
  RC.onLangToggle(RC.$("lang"));
  installationLabel.textContent = installation;

  function showFatal(message) {
    fatal.textContent = message;
    RC.show(fatal, true);
  }

  function showToast(message, kind) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = "toast toast--" + (kind || "ok");
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 6000);
  }

  function fillSetup() {
    RC.$("installation").value = installation;
    RC.$("broker").value = broker;
    RC.show(setup, true);
    RC.show(waiting, false);
    RC.show(metersEl, false);
  }

  RC.$("setup-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var nextInstallation = RC.$("installation").value.trim();
    var nextToken = RC.$("token").value.trim();
    var nextBroker = RC.$("broker").value.trim() || RC.DEFAULTS.broker;
    if (!nextInstallation || !nextToken) return;
    localStorage.setItem("rc.installation", nextInstallation);
    localStorage.setItem("rc.reporter.token", nextToken);
    localStorage.setItem("rc.broker", nextBroker);
    location.reload();
  });

  RC.$("reset").addEventListener("click", function () {
    if (!confirm("Resetezi conexiunea? Datele din coada locală rămân până la următoarea conectare.")) return;
    localStorage.removeItem("rc.reporter.token");
    localStorage.removeItem("rc.installation");
    localStorage.removeItem("rc.broker");
    location.reload();
  });

  if (!token) {
    fillSetup();
    RC.renderConnection(conn, "off");
    return;
  }

  RC.show(setup, false);
  RC.show(waiting, true);
  RC.show(metersEl, false);

  client = RC.connect({
    role: "reporter",
    broker: broker,
    token: token,
    installation: installation,
    onStatus: function (state, detail) {
      connected = state === "on";
      RC.renderConnection(conn, state, detail);
      if (state === "err" && detail) waitingDetail.textContent = detail;
    },
    onConnect: function (c) {
      c.subscribe("meters/" + installation + "/submission/#", { qos: 1 }, function () {
        // Give the broker a moment to deliver retained submission state before
        // deciding whether a queued item is stale. The queue is not flushed
        // from onStatus, which fires before this subscription exists.
        setTimeout(flushQueue, 800);
      });
    },
    onConfig: function (err, cfg) {
      if (err) {
        RC.show(waiting, false);
        showFatal(RC.t("invalid_config") + " " + err.message);
        return;
      }
      if (!cfg) {
        config = null;
        submissions = {};
        metersEl.innerHTML = "";
        RC.show(metersEl, false);
        RC.show(setup, false);
        RC.show(waiting, true);
        waitingDetail.textContent = RC.t("empty_config");
        return;
      }
      config = RCSchema.normalize(cfg, installation);
      render();
    },
    onFatal: showFatal
  });

  function refreshWhenIdle() {
    if (!config) return;
    if (document.querySelector(":focus")) return;
    render();
  }
  setInterval(refreshWhenIdle, 60000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshWhenIdle();
  });

  if (client) {
    client.on("message", function (topic, payload) {
      var prefix = "meters/" + installation + "/submission/";
      if (topic.indexOf(prefix) !== 0) return;
      var rest = topic.slice(prefix.length).split("/");
      if (rest.length < 2) return;
      var meterId = rest[0];
      var period = rest[1];
      var text = payload ? payload.toString() : "";
      if (!text) {
        delete submissions[meterId + "|" + period];
        render();
        return;
      }
      try {
        var submission = JSON.parse(text);
        if (!submission || submission.meter_id !== meterId || submission.period !== period ||
            submission.index === null || submission.index === undefined || submission.index === "" ||
            !isFinite(Number(submission.index))) {
          return;
        }
        submissions[meterId + "|" + period] = submission;
        render();
      } catch (err) {
        /* ignore malformed retained payloads */
      }
    });
  }

  function key(meterId, period) {
    return meterId + "|" + period;
  }

  function hasSubmission(meterId, period) {
    return Boolean(submissions[key(meterId, period)]);
  }

  function meterById(meterId) {
    if (!config) return null;
    for (var i = 0; i < config.meters.length; i += 1) {
      if (config.meters[i].id === meterId) return config.meters[i];
    }
    return null;
  }

  function findCard(meterId) {
    var cards = metersEl.querySelectorAll("[data-meter-id]");
    for (var i = 0; i < cards.length; i += 1) {
      if (cards[i].getAttribute("data-meter-id") === String(meterId)) return cards[i];
    }
    return null;
  }

  function periodStateFor(meter) {
    return RCPeriod.state(meter.window, new Date(), function (period) {
      return hasSubmission(meter.id, period);
    }, config && config.timezone);
  }

  function baselineBefore(meterId, period) {
    var candidates = Object.keys(submissions).map(function (k) { return submissions[k]; })
      .filter(function (s) { return s && s.meter_id === meterId && String(s.period) < String(period); });
    candidates.sort(function (a, b) {
      if (a.period === b.period) return new Date(b.submitted_at) - new Date(a.submitted_at);
      return String(b.period).localeCompare(String(a.period));
    });
    if (candidates.length) {
      return {
        index: Number(candidates[0].index),
        at: candidates[0].submitted_at || null,
        period: candidates[0].period
      };
    }
    var meter = meterById(meterId);
    if (meter && meter.baseline && meter.baseline.index !== null && meter.baseline.index !== undefined) {
      return { index: Number(meter.baseline.index), at: meter.baseline.at || null, period: null };
    }
    return null;
  }

  function latestForDisplay(meter, state) {
    if (state.reported) {
      var current = submissions[key(meter.id, state.period)];
      if (current) return { index: current.index, at: current.submitted_at, period: current.period };
    }
    return baselineBefore(meter.id, state.period);
  }

  function expectedInfo(meter, baseline, period) {
    var typical = RCSchema.typicalIndexForMonth(meter, period);
    if (!baseline || !baseline.at || baseline.index === null || typical === null) return null;
    var args = RCSchema.thresholdArgs(meter);
    var result = RCAnomaly.evaluate({
      index: baseline.index,
      lastIndex: baseline.index,
      lastAt: baseline.at,
      typicalMonth: typical,
      thresholdMode: args.thresholdMode,
      warnDelta: args.warnDelta,
      refuseDelta: args.refuseDelta,
      warnPct: args.warnPct,
      refusePct: args.refusePct,
      now: new Date()
    });
    return result.available ? result : null;
  }

  function evaluateIndex(meter, index, reset) {
    var state = periodStateFor(meter);
    var baseline = baselineBefore(meter.id, state.period);
    var typical = RCSchema.typicalIndexForMonth(meter, state.period);
    var args = RCSchema.thresholdArgs(meter);
    return RCAnomaly.evaluate({
      index: index,
      lastIndex: baseline ? baseline.index : null,
      lastAt: baseline ? baseline.at : null,
      typicalMonth: typical,
      thresholdMode: args.thresholdMode,
      warnDelta: args.warnDelta,
      refuseDelta: args.refuseDelta,
      warnPct: args.warnPct,
      refusePct: args.refusePct,
      reset: Boolean(reset),
      now: new Date()
    });
  }

  function fmt(value, meter) {
    return RC.fmtIndex(value, meter.precision);
  }

  function typicalText(meter, period) {
    var typical = RCSchema.typicalForMonth(meter, period);
    if (typical === null) return RC.t("not_configured");
    var unit = RCSchema.consumptionUnit(meter);
    var text = fmt(typical, meter) + " " + RC.escape(unit) + " / " + RC.t("month");
    var indexUnits = RCSchema.typicalIndexForMonth(meter, period);
    if (indexUnits !== null && unit && unit !== (meter.unit || "")) {
      text += " (≈ " + fmt(indexUnits, meter) + " " + RC.escape(meter.unit || "") + ")";
    }
    return text;
  }

  function fmtDateTime(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat(RC.lang() === "en" ? "en-GB" : "ro-RO", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(d);
  }

  function periodLabel(period) {
    if (!period) return "—";
    var d = new Date(period + "-01T12:00:00");
    if (isNaN(d.getTime())) return period;
    return new Intl.DateTimeFormat(RC.lang() === "en" ? "en-GB" : "ro-RO", {
      month: "long",
      year: "numeric"
    }).format(d);
  }

  function windowText(meter, state) {
    if (!meter.window) return RC.t("no_window_anytime");
    var base = RC.t("window") + ": " + meter.window.open_day + " " + (meter.window.open_time || "00:00") +
      " – " + meter.window.close_day + " " + (meter.window.close_time || "23:59");
    if (state.state === "open") return base + " · " + RC.t("open_until") + " " + fmtDateTime(state.closesAt);
    if (state.state === "late") return base + " · " + RC.t("window_closed_on") + " " + fmtDateTime(state.closesAt);
    if (state.state === "upcoming") return base + " · " + RC.t("window_opens_on") + " " + fmtDateTime(state.opensAt);
    if (state.state === "reported") return base + " · " + RC.t("reported_for") + " " + periodLabel(state.period);
    return base;
  }

  function badge(state) {
    var map = {
      open: [RC.t("open_badge"), "badge--ok"],
      late: [RC.t("late_badge"), "badge--warn"],
      upcoming: [RC.t("upcoming_badge"), "badge--muted"],
      reported: [RC.t("reported_badge"), "badge--ok"]
    };
    var chosen = map[state.state] || map.upcoming;
    return '<span class="badge ' + chosen[1] + '">' + chosen[0] + '</span>';
  }

  function queueItemFor(meterId, period) {
    var queue = readQueue();
    for (var i = 0; i < queue.length; i += 1) {
      if (queue[i].installation === installation && queue[i].meter_id === meterId && queue[i].period === period) {
        return queue[i];
      }
    }
    return null;
  }

  function historyHtml(meter) {
    var rows = Object.keys(submissions).map(function (k) { return submissions[k]; })
      .filter(function (s) { return s && s.meter_id === meter.id; })
      .sort(function (a, b) {
        if (a.period === b.period) return new Date(b.submitted_at) - new Date(a.submitted_at);
        return String(b.period).localeCompare(String(a.period));
      })
      .slice(0, 4);

    if (!rows.length) return '<p class="muted">' + RC.t("no_history") + '</p>';

    return '<ul class="history__list">' + rows.map(function (row) {
      var tags = [];
      if (row.late) tags.push('<span class="badge badge--warn">' + RC.t("late") + '</span>');
      if (row.corrected) tags.push('<span class="badge badge--muted">' + RC.t("corrected") + '</span>');
      if (row.photo) tags.push('<span class="badge badge--muted">' + RC.t("photo") + '</span>');
      return '<li><span class="mono">' + RC.escape(row.period) + '</span>' +
        '<strong>' + fmt(row.index, meter) + ' ' + RC.escape(meter.unit || "") + '</strong>' +
        '<span class="muted">' + RC.escape(fmtDateTime(row.submitted_at)) + '</span>' +
        '<span class="history__tags">' + tags.join(" ") + '</span></li>';
    }).join("") + '</ul>';
  }

  function photoPreviewHtml(meter) {
    var photo = photoDrafts[meter.id];
    if (!photo) return "";
    return '<img class="photo-preview__img" alt="' + RC.t("photo") + '" src="data:image/jpeg;base64,' + photo.base64 + '">' +
      '<span class="mono muted">' + Math.round(photo.bytes / 1024) + ' KB' + (photo.overLimit ? ' · ' + RC.t("photo_too_big") : '') + '</span>' +
      '<button class="ghost photo-remove" type="button">' + RC.t("photo_remove") + '</button>';
  }

  function meterCard(meter) {
    var state = periodStateFor(meter);
    var baseline = latestForDisplay(meter, state);
    var rangeBase = baselineBefore(meter.id, state.period);
    var info = expectedInfo(meter, rangeBase, state.period);
    var typicalLabel = typicalText(meter, state.period);
    var draft = drafts[meter.id] || "";
    var external = meter.reading_mode === "external";
    var disabled = state.state === "upcoming" || external;
    var submitLabel = state.reported ? RC.t("correct") : RC.t("send");
    var photoEnabled = !external && (!meter.photo || meter.photo.enabled !== false);
    var step = meter.precision > 0 ? String(1 / Math.pow(10, meter.precision)) : "1";
    var expected = info
      ? RC.t("expected") + ": " + fmt(info.expectedIndex, meter) + " " + RC.escape(meter.unit || "") +
        " · " + RC.t("normal") + " " + fmt(info.normalLow, meter) + "–" + fmt(info.normalHigh, meter) +
        " · " + RC.t("refuse") + " " + fmt(info.refuseLow, meter) + "–" + fmt(info.refuseHigh, meter)
      : RC.t("expected_unavailable");

    return [
      '<article class="meter" data-meter-id="' + RC.escape(meter.id) + '">',
      '  <div class="meter__head">',
      '    <div><h2>' + RC.escape(meter.name || meter.id) + '</h2>',
      '      <div class="meter__provider">' + RC.escape(meter.provider || "") + '</div></div>',
      badge(state),
      '  </div>',
      '  <div class="meter__grid">',
      '    <div class="stat"><div class="stat__label">' + RC.t("last_index") + '</div>',
      '      <div class="stat__value">' + (baseline ? fmt(baseline.index, meter) : RC.t("no_baseline")) + '</div>',
      '      <div class="mono muted">' + (baseline && baseline.at ? RC.escape(fmtDateTime(baseline.at)) : "") + '</div></div>',
      '    <div class="stat"><div class="stat__label">' + RC.t("typical") + '</div>',
      '      <div class="stat__value">' + typicalLabel + '</div></div>',
      '    <div class="stat"><div class="stat__label">' + RC.t("period") + '</div>',
      '      <div class="stat__value">' + RC.escape(periodLabel(state.period)) + '</div></div>',
      '  </div>',
      '  <p class="meter__window">' + RC.escape(windowText(meter, state)) + '</p>',
      external
        ? '  <p class="hint">' + RC.t("external_read") + '</p>'
        : [
          '  <div class="meter__form">',
          '    <label class="field"><span>' + RC.t("index_label") + '</span>',
          '      <input class="index-input" type="number" inputmode="decimal" min="0" step="' + step + '" value="' + RC.escape(draft) + '"' + (disabled ? " disabled" : "") + '></label>',
          '    <p class="hint" data-role="hint">' + expected + '</p>',
          '    <label class="check" data-role="warn-check" hidden><input type="checkbox" class="confirm-warn"> ' + RC.t("warn_confirm") + '</label>',
          '    <label class="check" data-role="reset-check" hidden><input type="checkbox" class="confirm-reset"> ' + RC.t("reset_confirm") + '</label>',
          photoEnabled ? [
            '    <div class="photo-row">',
            '      <label class="photo-btn">📷 ' + RC.t("photo_add") + '<input class="photo-input" type="file" accept="image/*" capture="environment" hidden></label>',
            '      <div class="photo-preview" data-role="photo-preview">' + photoPreviewHtml(meter) + '</div>',
            '    </div>'
          ].join("") : "",
          '    <div class="meter__actions">',
          '      <span class="state" data-role="state"></span>',
          '      <button class="primary submit" type="button"' + (disabled ? " disabled" : "") + '>' + RC.escape(submitLabel) + '</button>',
          '    </div>',
          '  </div>'
        ].join(""),
      '  <details class="history"><summary>' + RC.t("history") + '</summary>' + historyHtml(meter) + '</details>',
      '</article>'
    ].join("");
  }

  function render() {
    if (!config) return;
    var active = document.activeElement;
    var activeCard = active && active.closest ? active.closest("[data-meter-id]") : null;
    var focusMeterId = activeCard ? activeCard.getAttribute("data-meter-id") : null;
    var focusStart = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    var focusEnd = active && typeof active.selectionEnd === "number" ? active.selectionEnd : null;
    var visible = RCSchema.visibleMeters(config);
    var grouped = RCSchema.metersByHouse(config);
    metersEl.innerHTML = RCSchema.houses(config).map(function (house) {
      if (house.visible === false) return "";
      var meters = (grouped[house.id] || []).filter(function (meter) { return visible.indexOf(meter) >= 0; });
      if (!meters.length) return "";
      return [
        '<section class="house-group" data-house-id="' + RC.escape(house.id) + '">',
        '  <div class="house-group__head">',
        '    <h2>' + RC.escape(house.name || house.id) + '</h2>',
        '  </div>',
        '  <div class="meters">' + meters.map(meterCard).join("") + '</div>',
        '</section>'
      ].join("");
    }).join("");
    RC.show(waiting, false);
    RC.show(setup, false);
    RC.show(metersEl, true);
    if (!visible.length) {
      RC.show(metersEl, false);
      RC.show(waiting, true);
      waitingDetail.textContent = RC.t("no_visible_meters");
    }
    visible.forEach(function (meter) { updateCard(meter); });
    if (focusMeterId) {
      var restored = findCard(focusMeterId);
      var restoredInput = restored && restored.querySelector(".index-input");
      if (restoredInput) {
        restoredInput.focus();
        if (focusStart !== null && restoredInput.setSelectionRange) {
          try { restoredInput.setSelectionRange(focusStart, focusEnd); } catch (err) { /* number input */ }
        }
      }
    }
  }

  function updateCard(meter) {
    var card = findCard(meter.id);
    if (!card) return;
    var input = card.querySelector(".index-input");
    if (meter.reading_mode === "external" || !input) return;
    var hint = card.querySelector('[data-role="hint"]');
    var stateEl = card.querySelector('[data-role="state"]');
    var warnCheck = card.querySelector('[data-role="warn-check"]');
    var resetCheck = card.querySelector('[data-role="reset-check"]');
    var warnInput = card.querySelector(".confirm-warn");
    var resetInput = card.querySelector(".confirm-reset");
    var submit = card.querySelector(".submit");
    var current = periodStateFor(meter);
    var queue = queueItemFor(meter.id, current.period);

    submit.textContent = current.reported ? RC.t("correct") : RC.t("send");
    submit.disabled = current.state === "upcoming";
    warnCheck.hidden = true;
    resetCheck.hidden = true;
    stateEl.className = "state";

    if (current.state === "upcoming") {
      stateEl.textContent = RC.t("window_not_open");
      return;
    }

    var raw = input.value.trim().replace(",", ".");
    if (!raw) {
      stateEl.textContent = queue ? RC.t("queue_pending") : (current.reported ? RC.t("reported_for") + " " + periodLabel(current.period) : "");
      submit.disabled = true;
      return;
    }

    var value = Number(raw);
    if (!isFinite(value) || value < 0) {
      stateEl.textContent = RC.t("invalid_hint");
      stateEl.classList.add("state--refuse");
      submit.disabled = true;
      return;
    }

    var result = evaluateIndex(meter, value, resetInput.checked);
    var messages = {
      ok: RC.t("ok_hint"),
      warn: RC.t("warn_hint"),
      refuse: RC.t("refuse_hint"),
      unknown: RC.t("first_hint"),
      rollover: RC.t("rollover_hint"),
      invalid: RC.t("invalid_hint")
    };
    stateEl.textContent = result.reset
      ? RC.t("reset_hint")
      : (queue ? RC.t("queue_pending") : (messages[result.state] || ""));
    stateEl.classList.add(result.state === "ok" || result.state === "unknown" ? "state--ok" : "state--warn");
    if (result.state === "refuse" || result.state === "invalid") {
      stateEl.classList.remove("state--warn");
      stateEl.classList.add("state--refuse");
    }

    warnCheck.hidden = result.state !== "warn";
    resetCheck.hidden = result.state !== "rollover";

    var canSubmit = result.state === "ok" || result.state === "unknown";
    if (result.state === "warn") canSubmit = warnInput.checked;
    if (result.state === "rollover") canSubmit = resetInput.checked;
    submit.disabled = !canSubmit;
  }

  function readQueue() {
    try {
      var raw = localStorage.getItem("rc.queue");
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeQueue(queue) {
    try {
      localStorage.setItem("rc.queue", JSON.stringify(queue));
      return true;
    } catch (err) {
      var slim = queue.map(function (item) {
        return Object.assign({}, item, { photoBase64: null, photo: false });
      });
      try {
        localStorage.setItem("rc.queue", JSON.stringify(slim));
        showToast(RC.t("queue_photo_dropped"), "warn");
        return true;
      } catch (err2) {
        showToast(RC.t("queue_full"), "err");
        return false;
      }
    }
  }

  function enqueue(item) {
    var queue = readQueue().filter(function (existing) {
      return !(existing.installation === installation && existing.meter_id === item.meter_id && existing.period === item.period);
    });
    queue.push(item);
    if (writeQueue(queue)) {
      showToast(RC.t("toast_queued"), "warn");
      render();
      return true;
    }
    return false;
  }

  function removeQueue(item) {
    var queue = readQueue().filter(function (existing) {
      if (item.id) return existing.id !== item.id;
      return !(existing.installation === installation && existing.meter_id === item.meter_id && existing.period === item.period);
    });
    writeQueue(queue);
  }

  function prepareQueuedItem(item) {
    var meter = meterById(item.meter_id);
    var corrected = hasSubmission(item.meter_id, item.period);
    var late = false;
    if (meter && meter.window) {
      var window = RCPeriod.forPeriod(meter.window, item.period);
      late = Boolean(window && new Date() > window.close);
    }
    return Object.assign({}, item, {
      corrected: corrected,
      late: late
    });
  }

  function submissionTopic(item) {
    return "meters/" + installation + "/submission/" + item.meter_id + "/" + item.period;
  }

  function photoTopic(item) {
    return "meters/" + installation + "/photo/" + item.meter_id + "/" + item.period;
  }

  function eventTopic() {
    return "meters/" + installation + "/event/index";
  }

  function publishItem(mqttClient, item) {
    return new Promise(function (resolve, reject) {
      function payload(photoOk) {
        var body = Object.assign({}, item);
        delete body.photoBase64;
        body.photo = photoOk;
        return JSON.stringify(body);
      }

      function sendSubmission(photoOk) {
        var body = payload(photoOk);
        mqttClient.publish(submissionTopic(item), body, { qos: 1, retain: true }, function (err) {
          if (err) {
            reject(err);
            return;
          }
          // A retained per-meter pointer so HA always has the latest submission
          // without relying on wildcard retained-message ordering.
          mqttClient.publish("meters/" + installation + "/last/" + item.meter_id, body, { qos: 1, retain: true }, function (lastErr) {
            var event = {
              v: 1,
              id: item.id,
              meter_id: item.meter_id,
              period: item.period,
              index: item.index,
              submitted_by: item.submitted_by,
              submitted_at: item.submitted_at
            };
            // Notification is HA's job; this is only a non-retained data event.
            // A failed event does not invalidate the retained reading.
            mqttClient.publish(eventTopic(), JSON.stringify(event), { qos: 1, retain: false }, function (eventErr) {
              resolve({ photo: photoOk, lastOk: !lastErr, eventOk: !eventErr });
            });
          });
        });
      }

      if (item.photoBase64) {
        mqttClient.publish(photoTopic(item), item.photoBase64, { qos: 1, retain: true }, function (err) {
          if (err) sendSubmission(false);
          else sendSubmission(true);
        });
      } else if (item.corrected) {
        // A correction without a new photo must not leave the previous retained
        // image attached to a submission that says photo:false.
        mqttClient.publish(photoTopic(item), "", { qos: 1, retain: true }, function () {
          sendSubmission(false);
        });
      } else {
        sendSubmission(false);
      }
    });
  }

  function flushQueue() {
    if (!client || !connected || flushing) return;
    var queue = readQueue().filter(function (item) { return item.installation === installation; });
    if (!queue.length) return;
    flushing = true;

    var failed = false;
    var chain = Promise.resolve();
    queue.forEach(function (item) {
      chain = chain.then(function () {
        var prepared = prepareQueuedItem(item);
        return publishItem(client, prepared).then(function (result) {
          var stored = Object.assign({}, prepared, { photo: result.photo });
          delete stored.photoBase64;
          submissions[key(prepared.meter_id, prepared.period)] = stored;
          if (!result.lastOk) {
            // The submission is retained, but HA's last pointer did not move.
            // Keep the item queued so the pointer is retried; do not lose it.
            failed = true;
            return;
          }
          removeQueue(item);
        }).catch(function () {
          failed = true;
        });
      });
    });
    chain.then(function () {
      render();
      showToast(failed ? RC.t("queue_error") : RC.t("toast_queue_sent"), failed ? "err" : "ok");
    }).then(function () {
      flushing = false;
    });
  }

  function clearDraft(meterId) {
    delete drafts[meterId];
    delete photoDrafts[meterId];
  }

  function onSubmit(meter) {
    var state = periodStateFor(meter);
    if (state.state === "upcoming") {
      showToast(RC.t("window_not_open"), "warn");
      return;
    }
    var card = findCard(meter.id);
    if (!card) return;
    var input = card.querySelector(".index-input");
    var raw = input.value.trim().replace(",", ".");
    var value = Number(raw);
    if (!raw || !isFinite(value) || value < 0) {
      showToast(RC.t("invalid_hint"), "err");
      return;
    }

    var reset = card.querySelector(".confirm-reset").checked;
    var warn = card.querySelector(".confirm-warn").checked;
    var result = evaluateIndex(meter, value, reset);
    var previous = baselineBefore(meter.id, state.period);

    if (meter.reading_mode === "external") {
      showToast(RC.t("external_read"), "warn");
      return;
    }
    if (result.state === "refuse" || result.state === "invalid") {
      showToast(RC.t("refuse_hint"), "err");
      return;
    }
    if (result.state === "warn" && !warn) {
      showToast(RC.t("toast_warn_confirm"), "warn");
      return;
    }
    if (result.state === "rollover" && !reset) {
      showToast(RC.t("toast_reset_confirm"), "warn");
      return;
    }

    var photo = meter.photo && meter.photo.enabled !== false ? photoDrafts[meter.id] : null;
    if (photo && photo.overLimit) {
      showToast(RC.t("photo_too_big"), "err");
      return;
    }
    var submission = RCSchema.buildSubmission({
      installation: installation,
      meter: meter,
      period: state.period,
      index: value,
      previous: previous,
      submitted_by: "index_submitter",
      range_state: result.state,
      photo: Boolean(photo),
      late: Boolean(state.late),
      corrected: Boolean(state.reported),
      reset: Boolean(reset),
      client: {
        tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Bucharest"),
        ua: String(navigator.userAgent || "").slice(0, 140)
      }
    });
    var item = Object.assign({}, submission, {
      photoBase64: photo ? photo.base64 : null
    });

    card.querySelector('[data-role="state"]').textContent = RC.t("sending");
    card.querySelector(".submit").disabled = true;

    if (client && connected) {
      publishItem(client, item).then(function (published) {
        var stored = Object.assign({}, submission, { photo: published.photo });
        submissions[key(stored.meter_id, stored.period)] = stored;
        clearDraft(meter.id);
        render();
        if (!published.lastOk) {
          if (enqueue(item)) showToast(RC.t("toast_last_failed"), "warn");
          return;
        }
        var photoFailed = Boolean(photo) && !published.photo;
        showToast(photoFailed ? RC.t("toast_photo_failed") : RC.t("toast_sent"), photoFailed ? "warn" : "ok");
      }).catch(function () {
        if (enqueue(item)) {
          render();
        }
      });
    } else {
      enqueue(item);
      render();
    }
  }

  function onPhoto(meter, input) {
    var file = input.files && input.files[0];
    if (!file) return;
    if (!meter.photo || meter.photo.enabled === false) return;
    var card = input.closest("[data-meter-id]");
    var stateEl = card.querySelector('[data-role="state"]');
    stateEl.textContent = RC.t("photo_preparing");
    stateEl.className = "state state--ok";
    var maxKb = meter.photo && meter.photo.max_kb ? meter.photo.max_kb : 512;
    RCPhoto.prepare(file, maxKb).then(function (photo) {
      if (photo.overLimit) {
        delete photoDrafts[meter.id];
        render();
        showToast(RC.t("photo_too_big"), "warn");
        return;
      }
      photoDrafts[meter.id] = photo;
      render();
      showToast(RC.t("photo_ready"), "ok");
    }).catch(function (err) {
      stateEl.textContent = "";
      showToast(RC.t("photo_error") + " " + err.message, "err");
    });
    input.value = "";
  }

  metersEl.addEventListener("input", function (event) {
    var input = event.target;
    if (!input.classList.contains("index-input")) return;
    var card = input.closest("[data-meter-id]");
    if (!card) return;
    // A confirmation belongs to the exact value that was shown to the user.
    // Changing the index must require a fresh acknowledgement.
    card.querySelector(".confirm-warn").checked = false;
    card.querySelector(".confirm-reset").checked = false;
    drafts[card.dataset.meterId] = input.value;
    var meter = meterById(card.dataset.meterId);
    if (meter) updateCard(meter);
  });

  metersEl.addEventListener("change", function (event) {
    var target = event.target;
    var card = target.closest("[data-meter-id]");
    if (!card) return;
    var meter = meterById(card.dataset.meterId);
    if (!meter) return;
    if (target.classList.contains("photo-input")) {
      onPhoto(meter, target);
      return;
    }
    if (target.classList.contains("confirm-warn") || target.classList.contains("confirm-reset")) {
      updateCard(meter);
    }
  });

  metersEl.addEventListener("click", function (event) {
    var target = event.target;
    var card = target.closest("[data-meter-id]");
    if (!card) return;
    var meter = meterById(card.dataset.meterId);
    if (!meter) return;
    if (target.classList.contains("submit")) {
      onSubmit(meter);
      return;
    }
    if (target.classList.contains("photo-remove")) {
      delete photoDrafts[meter.id];
      render();
    }
  });

})();
