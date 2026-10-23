/* Admin page — full config editor, publisher, history and invite link. */
(function () {
  "use strict";

  var params = RC.parseParams();
  var token = params.token || sessionStorage.getItem("rc.admin.token") || "";
  var installation = params.installation || localStorage.getItem("rc.installation") || RC.DEFAULTS.installation;
  var broker = params.broker || localStorage.getItem("rc.broker") || RC.DEFAULTS.broker;

  if (params.token || params.installation || params.broker) {
    if (params.token) sessionStorage.setItem("rc.admin.token", params.token);
    if (params.installation) localStorage.setItem("rc.installation", params.installation);
    if (params.broker) localStorage.setItem("rc.broker", params.broker);
    RC.stripUrl();
  }

  var setup = RC.$("setup");
  var admin = RC.$("admin");
  var housesEl = RC.$("houses-editor");
  var editor = RC.$("editor");
  var citiriEl = RC.$("citiri");
  var citiriHouseEl = RC.$("citiri-house");
  var citiriHouseInitialized = false;
  var proposalsEl = RC.$("proposals");
  var companyStatusEl = RC.$("company-status");
  var notificationsEl = RC.$("notifications");
  var configJson = RC.$("config-json");
  var saveStatus = RC.$("save-status");
  var historyEl = RC.$("history");
  var historyHouseEl = RC.$("history-house");
  var historyHouseInitialized = false;
  var resetMeterEl = RC.$("reset-meter");
  var resetReportingEl = RC.$("reset-reporting");
  var resetStatusEl = RC.$("reset-status");
  var fatal = RC.$("fatal");
  var conn = RC.$("conn");
  var toastEl = RC.$("toast");
  var modal = RC.$("modal");
  var modalImg = RC.$("modal-img");
  var modalTitle = RC.$("modal-title");

  var config = null;
  var dirty = false;
  var connected = false;
  var client = null;
  var submissions = {};
  var statuses = {};
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll("[data-tab]"));
  var tabPanels = Array.prototype.slice.call(document.querySelectorAll("[data-tab-panel]"));
  var toastTimer = null;
  var loadTimer = null;
  var lastPublishedAt = null;
  var loadedOnce = false;
  var photoRequest = 0;

  RC.applyI18n();
  RC.$("installation-label").textContent = installation;

  function showTab(name, persist) {
    var found = tabButtons.some(function (button) {
      return button.getAttribute("data-tab") === name;
    });
    if (!found) name = "reporting";
    tabButtons.forEach(function (button) {
      var active = button.getAttribute("data-tab") === name;
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    tabPanels.forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-tab-panel") !== name;
    });
    if (persist) {
      try { sessionStorage.setItem("rc.admin.tab", name); } catch (_) { /* private mode */ }
    }
  }

  tabButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      showTab(button.getAttribute("data-tab") || "reporting", true);
    });
  });

  var initialTab = "reporting";
  try { initialTab = sessionStorage.getItem("rc.admin.tab") || "reporting"; } catch (_) { /* private mode */ }
  showTab(initialTab, false);

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

  function setStatus(message, kind) {
    saveStatus.textContent = message;
    saveStatus.className = "notice" + (kind ? " notice--" + kind : "");
  }

  function markDirty() {
    dirty = true;
    setStatus("Modificări nesalvate. Apasă „Publică configurația”.", "warn");
  }

  function fillSetup() {
    RC.$("installation").value = installation;
    RC.$("broker").value = broker;
    RC.show(setup, true);
    RC.show(admin, false);
  }

  RC.$("setup-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var nextInstallation = RC.$("installation").value.trim();
    var nextToken = RC.$("token").value.trim();
    var nextBroker = RC.$("broker").value.trim() || RC.DEFAULTS.broker;
    if (!nextInstallation || !nextToken) return;
    localStorage.setItem("rc.installation", nextInstallation);
    sessionStorage.setItem("rc.admin.token", nextToken);
    localStorage.setItem("rc.broker", nextBroker);
    location.reload();
  });

  RC.$("logout").addEventListener("click", function () {
    sessionStorage.removeItem("rc.admin.token");
    location.reload();
  });

  if (!token) {
    fillSetup();
    RC.renderConnection(conn, "off");
    return;
  }

  RC.show(setup, false);
  RC.show(admin, true);

  client = RC.connect({
    role: "admin",
    broker: broker,
    token: token,
    installation: installation,
    onStatus: function (state, detail) {
      connected = state === "on";
      RC.renderConnection(conn, state, detail);
      if (state === "err" && detail) showFatal(detail);
    },
    onConnect: function (c) {
      c.subscribe("meters/" + installation + "/submission/#", { qos: 1 });
      c.subscribe("meters/" + installation + "/status/#", { qos: 1 });
    },
    onConfig: function (err, cfg) {
      if (err) {
        showFatal(RC.t("invalid_config") + " " + err.message);
        return;
      }
      if (!cfg) {
        config = null;
        submissions = {};
        statuses = {};
        renderAll();
        setStatus("Configurația a fost ștearsă din MQTT. Încarcă seed sau publică o configurație nouă.", "warn");
        return;
      }
      if (!config || !dirty) {
        var needsHouseMigration = !Array.isArray(cfg.houses) || !cfg.houses.length;
        cfg = RCSchema.normalize(cfg, installation);
        config = cfg;
        renderAll();
        if (cfg.updated_at !== lastPublishedAt) {
          if (!loadedOnce) {
            setStatus("Configurație încărcată din MQTT.", "ok");
            loadedOnce = true;
          } else {
            setStatus("Configurație actualizată din MQTT.", "ok");
          }
        }
        if (needsHouseMigration) {
          setStatus("Configurație veche fără case. Adaugă casele și atribuie contoarele înainte de publicare.", "warn");
        }
        dirty = false;
      } else {
        setStatus("Configurația a fost schimbată în altă parte. Reîncarcă pagina pentru a evita suprascrierea.", "err");
      }
    },
    onFatal: showFatal
  });

  if (client) {
    client.on("message", function (topic, payload) {
      var submissionPrefix = "meters/" + installation + "/submission/";
      var statusPrefix = "meters/" + installation + "/status/";
      if (topic.indexOf(submissionPrefix) === 0) {
        var rest = topic.slice(submissionPrefix.length).split("/");
        if (rest.length >= 2) {
          var submissionKey = rest[0] + "|" + rest[1];
          var submissionText = payload ? payload.toString() : "";
          if (!submissionText) {
            delete submissions[submissionKey];
            renderHistory();
            return;
          }
          try {
            var submission = JSON.parse(submissionText);
            if (submission && submission.meter_id === rest[0] && submission.period === rest[1]) {
              submissions[submissionKey] = submission;
              renderHistory();
            }
          } catch (err) { /* ignore malformed */ }
        }
        return;
      }
      if (topic.indexOf(statusPrefix) === 0) {
        var srest = topic.slice(statusPrefix.length).split("/");
        if (srest.length >= 2) {
          var statusKey = srest[0] + "|" + srest[1];
          var statusText = payload ? payload.toString() : "";
          if (!statusText) {
            delete statuses[statusKey];
            renderHistory();
            renderProposals();
            renderCompanyStatus();
            return;
          }
          try {
            statuses[statusKey] = JSON.parse(statusText);
            renderHistory();
            renderProposals();
            renderCompanyStatus();
          } catch (err) { /* ignore malformed */ }
        }
      }
    });
  }

  loadTimer = setTimeout(function () {
    if (!config) setStatus("Nu există încă o configurație publicată. Încarcă seed, ajustează și publică.", "warn");
  }, 4000);

  function defaultWindow() {
    return { type: "monthly", open_day: 1, open_time: "09:00", close_day: 5, close_time: "23:59" };
  }

  function fallbackHouse() {
    return JSON.parse(JSON.stringify(RCSchema.FALLBACK_HOUSE));
  }

  function firstHouseId() {
    var houses = config && Array.isArray(config.houses) ? config.houses : [];
    return houses.length ? houses[0].id : "casa";
  }

  function blankHouse() {
    return {
      id: "house-" + Date.now().toString(36),
      name: "Casă nouă",
      order: (config && config.houses ? config.houses.length + 1 : 1),
      visible: true,
      _new: true
    };
  }

  function blankMeter() {
    return {
      id: "meter-" + Date.now().toString(36),
      house_id: firstHouseId(),
      name: "Contor nou",
      provider: "",
      kind: "electricity",
      unit: "kWh",
      precision: 0,
      visible: true,
      reading_mode: "manual",
      consumption_unit: "kWh",
      consumption_factor: 1,
      baseline: { index: null, at: null },
      typical_month: null,
      window: null,
      thresholds: { mode: "absolute", warn_margin: 50, refuse_margin: 100 },
      photo: { enabled: true, max_kb: 512 },
      _new: true
    };
  }

  function getPath(obj, path) {
    var parts = path.split(".");
    var current = obj;
    for (var i = 0; i < parts.length; i += 1) {
      if (current === null || current === undefined) return undefined;
      current = current[parts[i]];
    }
    return current;
  }

  function setPath(obj, path, value) {
    var parts = path.split(".");
    var current = obj;
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (!current[parts[i]] || typeof current[parts[i]] !== "object") current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  function inputValue(input) {
    if (input.type === "checkbox") return input.checked;
    if (input.type === "number") return input.value === "" ? null : Number(input.value);
    if (input.type === "date") return input.value ? new Date(input.value + "T12:00:00").toISOString() : null;
    return input.value;
  }

  function text(value) {
    return RC.escape(value === null || value === undefined ? "" : value);
  }

  function houseEditor(house, index) {
    return [
      '<div class="meter-editor" data-house-index="' + index + '">',
      '  <div class="row row--between">',
      '    <h2>' + RC.escape(house.name || house.id) + '</h2>',
      '    <button class="danger remove-house" type="button">Șterge</button>',
      '  </div>',
      '  <div class="form-grid">',
      '    <label class="field"><span>ID (slug)</span><input data-house-path="id" value="' + text(house.id) + '"' + (house._new ? '' : ' readonly') + '></label>',
      '    <label class="field"><span>Nume</span><input data-house-path="name" value="' + text(house.name) + '"></label>',
      '    <label class="field"><span>Ordine</span><input data-house-path="order" type="number" min="0" value="' + text(house.order) + '"></label>',
      '    <label class="check"><input data-house-path="visible" type="checkbox"' + (house.visible !== false ? ' checked' : '') + '> Vizibilă pentru raportor</label>',
      '  </div>',
      '</div>'
    ].join("");
  }

  function renderHouses() {
    if (!config) {
      housesEl.innerHTML = '<p class="muted">Nu există configurație.</p>';
      return;
    }
    if (!Array.isArray(config.houses) || !config.houses.length) {
      config.houses = [fallbackHouse()];
    }
    housesEl.innerHTML = config.houses.map(houseEditor).join("");
  }

  function houseOptions(selected) {
    return (config.houses || [fallbackHouse()]).map(function (house) {
      return '<option value="' + RC.escape(house.id) + '"' + (house.id === selected ? ' selected' : '') + '>' +
        RC.escape(house.name || house.id) + '</option>';
    }).join("");
  }

  function monthProfileFields(meter) {
    var names = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec"];
    var profile = meter.typical_by_month || {};
    return names.map(function (name, i) {
      var key = String(i + 1).padStart(2, "0");
      var value = Array.isArray(profile) ? profile[i] : profile[key];
      return '<label class="field"><span>' + name + '</span><input data-path="typical_by_month.' + key + '" type="number" step="any" min="0" value="' + text(value) + '"></label>';
    }).join("");
  }

  function meterEditor(meter, index) {
    var windowOn = Boolean(meter.window);
    return [
      '<div class="meter-editor" data-meter-index="' + index + '">',
      '  <div class="row row--between">',
      '    <h2>' + RC.escape(meter.name || meter.id) + (meter.visible === false ? ' <span class="badge badge--muted">ascuns</span>' : '') + '</h2>',
      '    <button class="danger remove-meter" type="button">Șterge</button>',
      '  </div>',
      '  <div class="form-grid">',
      '    <label class="field"><span>ID (slug)</span><input data-path="id" value="' + text(meter.id) + '"' + (meter._new ? '' : ' readonly') + '></label>',
      '    <label class="field"><span>Nume</span><input data-path="name" value="' + text(meter.name) + '"></label>',
      '    <label class="field"><span>Casă</span><select data-path="house_id">' + houseOptions(meter.house_id || firstHouseId()) + '</select></label>',
      '    <label class="field"><span>Furnizor</span><input data-path="provider" value="' + text(meter.provider) + '"></label>',
      '    <label class="field"><span>Tip</span><select data-path="kind">' +
        ['electricity', 'water', 'gas'].map(function (kind) {
          return '<option value="' + kind + '"' + (meter.kind === kind ? ' selected' : '') + '>' + kind + '</option>';
        }).join("") + '</select></label>',
      '    <label class="field"><span>Unitate index</span><input data-path="unit" value="' + text(meter.unit) + '"></label>',
      '    <label class="field"><span>Unitate consum</span><input data-path="consumption_unit" value="' + text(meter.consumption_unit || meter.unit) + '"></label>',
      '    <label class="field"><span>Factor consum / index</span><input data-path="consumption_factor" type="number" step="any" min="0.000001" value="' + text(meter.consumption_factor === undefined || meter.consumption_factor === null ? 1 : meter.consumption_factor) + '"></label>',
      '    <label class="field"><span>Precizie (zecimale)</span><input data-path="precision" type="number" min="0" max="3" value="' + text(meter.precision) + '"></label>',
      '    <label class="field"><span>Mod citire</span><select data-path="reading_mode">' +
        ['manual', 'external'].map(function (mode) {
          return '<option value="' + mode + '"' + ((meter.reading_mode || "manual") === mode ? ' selected' : '') + '>' + mode + '</option>';
        }).join("") + '</select></label>',
      '    <label class="field"><span>Index de bază</span><input data-path="baseline.index" type="number" step="any" value="' + text(meter.baseline ? meter.baseline.index : "") + '"></label>',
      '    <label class="field"><span>Data citirii de bază</span><input data-path="baseline.at" type="date" value="' + text(meter.baseline && meter.baseline.at ? String(meter.baseline.at).slice(0, 10) : "") + '"></label>',
      '    <label class="field"><span>Consum tipic / lună</span><input data-path="typical_month" type="number" step="any" min="0" value="' + text(meter.typical_month) + '"></label>',
      '    <label class="field"><span>Mod marje</span><select data-path="thresholds.mode">' +
        ['absolute', 'percent'].map(function (mode) {
          return '<option value="' + mode + '"' + ((meter.thresholds && meter.thresholds.mode || "absolute") === mode ? ' selected' : '') + '>' + mode + '</option>';
        }).join("") + '</select></label>',
      '    <label class="field"><span>Marjă avertizare</span><input data-path="thresholds.warn_margin" type="number" step="any" min="0" value="' + text(meter.thresholds ? meter.thresholds.warn_margin : "") + '"></label>',
      '    <label class="field"><span>Marjă refuz</span><input data-path="thresholds.refuse_margin" type="number" step="any" min="0" value="' + text(meter.thresholds ? meter.thresholds.refuse_margin : "") + '"></label>',
      '    <label class="field"><span>Avertizare %</span><input data-path="thresholds.warn_pct" type="number" step="any" min="0" value="' + text(meter.thresholds ? meter.thresholds.warn_pct : "") + '"></label>',
      '    <label class="field"><span>Refuz %</span><input data-path="thresholds.refuse_pct" type="number" step="any" min="0" value="' + text(meter.thresholds ? meter.thresholds.refuse_pct : "") + '"></label>',
      '    <label class="check"><input data-path="visible" type="checkbox"' + (meter.visible !== false ? ' checked' : '') + '> Vizibil pentru raportor</label>',
      '  </div>',
      '  <label class="check"><input data-window-toggle type="checkbox"' + (windowOn ? ' checked' : '') + '> Fereastră de raportare</label>',
      '  <div class="form-grid window-fields"' + (windowOn ? '' : ' hidden') + '>',
      '    <label class="field"><span>Zi deschidere</span><input data-path="window.open_day" type="number" min="1" max="31" value="' + text(windowOn ? meter.window.open_day : 1) + '"' + (windowOn ? '' : ' disabled') + '></label>',
      '    <label class="field"><span>Ora deschidere</span><input data-path="window.open_time" type="time" value="' + text(windowOn ? meter.window.open_time : "09:00") + '"' + (windowOn ? '' : ' disabled') + '></label>',
      '    <label class="field"><span>Zi închidere</span><input data-path="window.close_day" type="number" min="1" max="31" value="' + text(windowOn ? meter.window.close_day : 5) + '"' + (windowOn ? '' : ' disabled') + '></label>',
      '    <label class="field"><span>Ora închidere</span><input data-path="window.close_time" type="time" value="' + text(windowOn ? meter.window.close_time : "23:59") + '"' + (windowOn ? '' : ' disabled') + '></label>',
      '  </div>',
      '  <div class="form-grid">',
      '    <label class="check"><input data-path="photo.enabled" type="checkbox"' + (meter.photo && meter.photo.enabled !== false ? ' checked' : '') + '> Permite poză</label>',
      '    <label class="field"><span>Limită poză (KB)</span><input data-path="photo.max_kb" type="number" min="64" max="1024" value="' + text(meter.photo ? meter.photo.max_kb : 512) + '"></label>',
      '  </div>',
      '  <details class="history"><summary>Profil lunar (gaz / consum sezonier)</summary>',
      '    <div class="form-grid">' + monthProfileFields(meter) + '</div>',
      '  </details>',
      '</div>'
    ].join("");
  }

  function renderEditor() {
    if (!config || !Array.isArray(config.meters)) {
      editor.innerHTML = '<p class="muted">Nu există configurație. Încarcă seed sau adaugă un contor.</p>';
      return;
    }
    editor.innerHTML = config.meters.map(meterEditor).join("") ||
      '<p class="muted">Niciun contor. Adaugă unul.</p>';
  }

  function notificationsEditor() {
    notificationsEl.innerHTML = '<p class="muted">Rutarea notificărilor, entitățile de furnizor, contul SMTP și datele de contract sunt administrate exclusiv în Home Assistant. Nu sunt publicate în MQTT.</p>';
  }

  function renderJson() {
    configJson.textContent = config ? JSON.stringify(config, null, 2) : RC.t("empty_config");
  }

  function preferredAdminHouse(storageKey, houses) {
    var has = function (id) { return Boolean(id) && houses.some(function (house) { return house.id === id; }); };
    try {
      var stored = localStorage.getItem(storageKey);
      if (has(stored)) return stored;
    } catch (_) { /* private mode */ }
    var configured = config && config.admin_default_house;
    if (has(configured)) return configured;
    return "";
  }

  function renderCitiriHouseFilter() {
    if (!citiriHouseEl) return;
    var selected = citiriHouseEl.value;
    var houses = config ? RCSchema.houses(config) : [];
    citiriHouseEl.innerHTML = '<option value="">Toate casele</option>' + houses.map(function (house) {
      return '<option value="' + RC.escape(house.id) + '">' + RC.escape(house.name || house.id) + '</option>';
    }).join("");
    if (!citiriHouseInitialized) {
      citiriHouseEl.value = preferredAdminHouse("rc.admin.reportingHouse", houses);
      citiriHouseInitialized = true;
      return;
    }
    if (selected && houses.some(function (house) { return house.id === selected; })) citiriHouseEl.value = selected;
    else if (!selected) citiriHouseEl.value = "";
  }

  function renderHistoryHouseFilter() {
    if (!historyHouseEl || !config) return;
    var selected = historyHouseEl.value;
    var houses = RCSchema.houses(config);
    historyHouseEl.innerHTML = '<option value="">Toate casele</option>' + houses.map(function (house) {
      return '<option value="' + RC.escape(house.id) + '">' + RC.escape(house.name || house.id) + '</option>';
    }).join("");
    if (!historyHouseInitialized) {
      historyHouseEl.value = preferredAdminHouse("rc.admin.historyHouse", houses);
      historyHouseInitialized = true;
      return;
    }
    if (selected && houses.some(function (house) { return house.id === selected; })) historyHouseEl.value = selected;
    else if (!selected) historyHouseEl.value = "";
  }

  function renderHistory() {
    var selectedHouse = historyHouseEl ? historyHouseEl.value : "";
    var rows = Object.keys(submissions).map(function (k) { return submissions[k]; })
      .filter(function (row) {
        if (!selectedHouse) return true;
        var meter = meterById(row.meter_id);
        return meter && (meter.house_id || "casa") === selectedHouse;
      })
      .sort(function (a, b) {
        if (a.period === b.period) return new Date(b.submitted_at) - new Date(a.submitted_at);
        return String(b.period).localeCompare(String(a.period));
      });
    if (!rows.length) {
      historyEl.innerHTML = '<p class="muted">Nicio raportare încă.</p>';
      return;
    }
    var latestByMeter = {};
    rows.forEach(function (row) {
      var current = latestByMeter[row.meter_id];
      if (!current || String(row.period) > String(current)) latestByMeter[row.meter_id] = row.period;
    });
    historyEl.innerHTML = [
      '<table class="table"><thead><tr>',
      '<th>Casă</th><th>Contor</th><th>Perioadă</th><th>Index</th><th>Trimis</th><th>Stare</th><th>Foto</th><th>Acțiuni</th>',
      '</tr></thead><tbody>',
      rows.map(function (row) {
        var meter = (config && config.meters || []).filter(function (m) { return m.id === row.meter_id; })[0];
        var name = meter ? meter.name : row.meter_id;
        var house = meter ? RCSchema.houseName(config, meter) : "—";
        var unit = meter ? meter.unit : "";
        var status = statuses[row.meter_id + "|" + row.period];
        var tags = [];
        if (row.late) tags.push('<span class="badge badge--warn">întârziat</span>');
        if (row.corrected) tags.push('<span class="badge badge--muted">corectat</span>');
        if (status) tags.push('<span class="badge">' + RC.escape(status.state || "") + '</span>');
        return '<tr>' +
          '<td>' + RC.escape(house) + '</td>' +
          '<td>' + RC.escape(name) + '</td>' +
          '<td class="mono">' + RC.escape(row.period) + '</td>' +
          '<td><strong>' + RC.fmtIndex(row.index, meter ? meter.precision : 0) + '</strong> ' + RC.escape(unit) + '</td>' +
          '<td class="mono">' + RC.escape(String(row.submitted_at || "").replace("T", " ").slice(0, 16)) + '</td>' +
          '<td>' + tags.join(" ") + '</td>' +
          '<td>' + (row.photo ? '<button class="ghost view-photo" data-meter="' + RC.escape(row.meter_id) + '" data-period="' + RC.escape(row.period) + '" type="button">Vezi</button>' : '—') + '</td>' +
          '<td>' + (latestByMeter[row.meter_id] === row.period ? '<button class="ghost retry-ha" data-meter="' + RC.escape(row.meter_id) + '" data-period="' + RC.escape(row.period) + '" type="button">Reîncearcă HA</button>' : '—') + '</td>' +
          '</tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderProposals() {
    if (!proposalsEl) return;
    var keys = Object.keys(statuses).filter(function (key) {
      var status = statuses[key];
      return status && status.state === "proposed";
    });
    var badge = document.querySelector('[data-tab-badge="company"]');
    if (badge) {
      badge.textContent = keys.length ? String(keys.length) : "";
      badge.hidden = !keys.length;
    }
    if (!keys.length) {
      proposalsEl.innerHTML = '<p class="muted">Nicio propunere în așteptare.</p>';
      return;
    }
    proposalsEl.innerHTML = [
      '<table class="table"><thead><tr>',
      '<th>Contor</th><th>Perioadă</th><th>Index</th><th>Anterior</th><th>Delta</th><th>Gate</th><th>Acțiune</th>',
      '</tr></thead><tbody>',
      keys.map(function (key) {
        var status = statuses[key];
        var meter = meterById(status.meter_id);
        var name = meter ? meter.name : status.meter_id;
        var unit = meter ? meter.unit : "";
        var previous = status.previous_index;
        var delta = status.delta;
        return '<tr>' +
          '<td>' + RC.escape(name) + '</td>' +
          '<td class="mono">' + RC.escape(status.period || "") + '</td>' +
          '<td><strong>' + RC.fmtIndex(status.index, meter ? meter.precision : 0) + '</strong> ' + RC.escape(unit) + '</td>' +
          '<td>' + (previous !== null && previous !== undefined ? RC.fmtIndex(previous, meter ? meter.precision : 0) : '—') + '</td>' +
          '<td>' + (delta !== null && delta !== undefined ? ((Number(delta) >= 0 ? '+' : '') + RC.fmtIndex(delta, meter ? meter.precision : 0)) : '—') + '</td>' +
          '<td>' + RC.escape(status.gate || "—") + '</td>' +
          '<td><button class="ghost approve-proposal" data-meter="' + RC.escape(status.meter_id) + '" data-period="' + RC.escape(status.period || "") + '" type="button">Aprobă</button> ' +
          '<button class="danger suppress-proposal" data-meter="' + RC.escape(status.meter_id) + '" data-period="' + RC.escape(status.period || "") + '" type="button">Suprimă</button></td>' +
          '</tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderCompanyStatus() {
    if (!companyStatusEl) return;
    var keys = Object.keys(statuses).filter(function (key) {
      return statuses[key] && statuses[key].meter_id;
    }).sort(function (a, b) {
      var sa = statuses[a];
      var sb = statuses[b];
      var ta = String(sa.updated_at || sa.at || "");
      var tb = String(sb.updated_at || sb.at || "");
      if (ta === tb) return String(sb.period || "").localeCompare(String(sa.period || ""));
      return tb.localeCompare(ta);
    });
    if (!keys.length) {
      companyStatusEl.innerHTML = '<p class="muted">Nicio stare de companie încă.</p>';
      return;
    }
    companyStatusEl.innerHTML = [
      '<table class="table"><thead><tr>',
      '<th>Contor</th><th>Perioadă</th><th>Stare</th><th>Index</th><th>Detaliu</th><th>Actualizat</th>',
      '</tr></thead><tbody>',
      keys.map(function (key) {
        var status = statuses[key];
        var meter = meterById(status.meter_id);
        var name = meter ? meter.name : status.meter_id;
        var unit = meter ? meter.unit : "";
        var tags = ['<span class="badge">' + RC.escape(status.state || "—") + '</span>'];
        if (status.uncertain) tags.push('<span class="badge badge--warn">incert</span>');
        if (status.gate) tags.push('<span class="badge badge--muted">gate ' + RC.escape(status.gate) + '</span>');
        return '<tr>' +
          '<td>' + RC.escape(name) + '</td>' +
          '<td class="mono">' + RC.escape(status.period || "—") + '</td>' +
          '<td>' + tags.join(" ") + '</td>' +
          '<td>' + (status.index !== null && status.index !== undefined ? '<strong>' + RC.fmtIndex(status.index, meter ? meter.precision : 0) + '</strong> ' + RC.escape(unit) : '—') + '</td>' +
          '<td>' + RC.escape(status.detail || "—") + '</td>' +
          '<td class="mono">' + RC.escape(String(status.updated_at || status.at || "").replace("T", " ").slice(0, 16)) + '</td>' +
          '</tr>';
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function retryCompanyPreflight(meterId, period) {
    if (!client || !connected) {
      setStatus("Nu ești conectat la MQTT.", "err");
      return;
    }
    var submission = submissions[meterId + "|" + period];
    if (!submission) {
      setStatus("Citirea nu mai există în MQTT; reîncarcă istoricul.", "err");
      return;
    }
    var body = JSON.stringify(submission);
    var topic = "meters/" + installation + "/last/" + meterId;
    client.publish(topic, body, { qos: 1, retain: true }, function (err) {
      if (err) {
        setStatus("Reîncercarea HA a eșuat: " + err.message, "err");
        return;
      }
      setStatus("Preflight-ul HA a fost retrimis. Verifică tabul Companie pentru propunere.", "ok");
    });
  }

  function renderResetMeters() {
    if (!resetMeterEl) return;
    var selected = resetMeterEl.value;
    var meters = config && Array.isArray(config.meters) ? config.meters : [];
    resetMeterEl.innerHTML = meters.map(function (meter) {
      return '<option value="' + RC.escape(meter.id) + '">' + RC.escape(meter.name || meter.id) + ' · ' + RC.escape(RCSchema.houseName(config, meter)) + '</option>';
    }).join("");
    if (meters.some(function (meter) { return meter.id === selected; })) resetMeterEl.value = selected;
    if (resetReportingEl) resetReportingEl.disabled = !meters.length;
  }

  function resetReporting() {
    if (!client || !connected) return setStatus("Nu ești conectat la MQTT.", "err");
    var meterId = resetMeterEl ? resetMeterEl.value : "";
    var meter = meterById(meterId);
    if (!meter) return setStatus("Alege un contor.", "err");

    var subKeys = Object.keys(submissions).filter(function (key) {
      return submissions[key] && submissions[key].meter_id === meterId;
    });
    var statusKeys = Object.keys(statuses).filter(function (key) {
      return statuses[key] && statuses[key].meter_id === meterId;
    });
    var blocked = statusKeys.filter(function (key) {
      var status = statuses[key];
      return status.state === "sending" || status.state === "accepted" || status.state === "forwarded" ||
        (status.state === "error" && status.uncertain);
    });
    if (blocked.length) {
      var message = "Reset blocat: există status companie „" + blocked.map(function (key) { return statuses[key].state; }).join(", ") +
        "”. Verifică portalul furnizorului înainte de a reseta; nu transforma o trimitere incertă într-un resend.";
      if (resetStatusEl) resetStatusEl.textContent = message;
      setStatus(message, "err");
      return;
    }

    var periods = {};
    subKeys.forEach(function (key) {
      var row = submissions[key];
      if (row && row.period) periods[row.period] = true;
    });
    statusKeys.forEach(function (key) {
      var status = statuses[key];
      if (status && status.period) periods[status.period] = true;
    });
    var periodList = Object.keys(periods).sort();
    var prompt = "Resetezi raportarea pentru „" + (meter.name || meter.id) + "”?\n\n" +
      "Se șterg " + subKeys.length + " submission(s), " + statusKeys.length + " status(uri), last pointer, statusurile și foto pentru " +
      (periodList.length ? periodList.join(", ") : "perioadele cunoscute") + ".\n\n" +
      "Următoarea citire pornește din nou fluxul HA. O trimitere deja făcută la companie NU este anulată.";
    if (!confirm(prompt)) return;

    var jobs = [];
    periodList.forEach(function (period) {
      jobs.push({ topic: "meters/" + installation + "/submission/" + meterId + "/" + period, payload: "" });
      jobs.push({ topic: "meters/" + installation + "/status/" + meterId + "/" + period, payload: "" });
      jobs.push({ topic: "meters/" + installation + "/photo/" + meterId + "/" + period, payload: "" });
    });
    // Keep a retained marker instead of deleting last entirely: an empty last
    // would make the HA submission sensor unknown, and the reminder automation
    // deliberately treats unknown as broken (no reminder). A "reset" marker is
    // known to HA, differs from every real period, and fails company_preflight.
    var resetMarker = {
      v: 1,
      installation: installation,
      meter_id: meterId,
      period: "reset",
      index: null,
      submitted_at: new Date().toISOString(),
      submitted_by: "company_submitter",
      reset: true,
      cleared_at: new Date().toISOString()
    };
    jobs.push({ topic: "meters/" + installation + "/last/" + meterId, payload: JSON.stringify(resetMarker) });
    var seen = {};
    jobs = jobs.filter(function (job) {
      if (seen[job.topic]) return false;
      seen[job.topic] = true;
      return true;
    });

    if (resetStatusEl) resetStatusEl.textContent = "Se resetează…";
    setStatus("Se resetează raportarea pentru " + (meter.name || meter.id) + "…", "warn");
    var pending = jobs.length;
    var failures = [];
    jobs.forEach(function (job) {
      client.publish(job.topic, job.payload, { qos: 1, retain: true }, function (err) {
        if (err) failures.push(job.topic + ": " + err.message);
        pending -= 1;
        if (pending > 0) return;
        subKeys.forEach(function (key) { delete submissions[key]; });
        statusKeys.forEach(function (key) { delete statuses[key]; });
        renderHistory();
        renderProposals();
        renderCompanyStatus();
        renderResetMeters();
        if (failures.length) {
          var error = "Reset parțial: " + failures.length + " topic(uri) au eșuat. " + failures[0];
          if (resetStatusEl) resetStatusEl.textContent = error;
          setStatus(error, "err");
        } else {
          var done = "Reset complet pentru " + (meter.name || meter.id) + ". Următoarea citire pornește din nou fluxul HA.";
          if (resetStatusEl) resetStatusEl.textContent = done;
          setStatus(done, "ok");
        }
      });
    });
  }

  function publishCompanyCommand(meterId, period, action, row) {
    if (!client || !connected) {
      setStatus("Nu ești conectat la MQTT.", "err");
      return;
    }
    var status = statuses[meterId + "|" + period];
    if (!status || status.state !== "proposed" || status.index === null || status.index === undefined) {
      setStatus("Propunerea nu mai este în așteptare sau nu are un index valid. Reîncarcă datele.", "err");
      return;
    }
    if (action === "approve" && !confirm("Aprobi trimiterea indexului " + status.index + " pentru " + period + " către companie?")) {
      return;
    }
    var payload = JSON.stringify({
      action: action,
      period: period,
      index: status.index,
      previous_index: status.previous_index,
      delta: status.delta,
      by: "company_submitter",
      at: new Date().toISOString()
    });
    var buttons = row ? row.querySelectorAll("button") : [];
    for (var i = 0; i < buttons.length; i += 1) buttons[i].disabled = true;
    client.publish("meters/" + installation + "/command/" + meterId + "/" + period, payload, { qos: 1, retain: false }, function (err) {
      if (err) {
        for (var j = 0; j < buttons.length; j += 1) buttons[j].disabled = false;
        setStatus("Comanda a eșuat: " + err.message, "err");
        return;
      }
      setStatus(action === "approve" ? "Aprobare trimisă către HA." : "Suprimare trimisă către HA.", "ok");
    });
  }

  function meterById(meterId) {
    if (!config || !Array.isArray(config.meters)) return null;
    for (var i = 0; i < config.meters.length; i += 1) {
      if (config.meters[i].id === meterId) return config.meters[i];
    }
    return null;
  }

  function hasSubmission(meterId, period) {
    return Boolean(submissions[meterId + "|" + period]);
  }

  function baselineBefore(meterId, period) {
    var candidates = Object.keys(submissions).map(function (key) { return submissions[key]; })
      .filter(function (s) { return s && s.meter_id === meterId && String(s.period) < String(period); });
    candidates.sort(function (a, b) {
      if (a.period === b.period) return new Date(b.submitted_at) - new Date(a.submitted_at);
      return String(b.period).localeCompare(String(a.period));
    });
    if (candidates.length) {
      return { index: Number(candidates[0].index), at: candidates[0].submitted_at || null };
    }
    var meter = meterById(meterId);
    if (meter && meter.baseline && meter.baseline.index !== null && meter.baseline.index !== undefined) {
      return { index: Number(meter.baseline.index), at: meter.baseline.at || null };
    }
    return null;
  }

  function citirePeriod(meter) {
    return RCPeriod.state(meter.window, new Date(), function (period) {
      return hasSubmission(meter.id, period);
    }, config && config.timezone);
  }

  function citireEvaluate(meter, index, reset) {
    var state = citirePeriod(meter);
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

  function typicalText(meter, period) {
    var typical = RCSchema.typicalForMonth(meter, period);
    if (typical === null) return "—";
    var unit = RCSchema.consumptionUnit(meter);
    var text = RC.fmtIndex(typical, meter.precision) + " " + RC.escape(unit);
    var indexUnits = RCSchema.typicalIndexForMonth(meter, period);
    if (indexUnits !== null && unit && unit !== (meter.unit || "")) {
      text += " (≈ " + RC.fmtIndex(indexUnits, meter.precision) + " " + RC.escape(meter.unit || "") + ")";
    }
    return text;
  }

  function citireCard(meter) {
    if (meter.reading_mode === "external") return "";
    var state = citirePeriod(meter);
    var baseline = baselineBefore(meter.id, state.period);
    var typicalLabel = typicalText(meter, state.period);
    var disabled = state.state === "upcoming";
    var last = baseline ? RC.fmtIndex(baseline.index, meter.precision) + " " + (meter.unit || "") : "fără valoare";
    return [
      '<article class="meter" data-citire-id="' + RC.escape(meter.id) + '">',
      '  <div class="meter__head"><div><h2>' + RC.escape(meter.name || meter.id) + '</h2>',
      '    <div class="meter__provider">' + RC.escape(RCSchema.houseName(config, meter)) + ' · ' + RC.escape(meter.provider || "") + '</div></div>',
      '    <span class="badge badge--muted">' + RC.escape(meter.id) + '</span></div>',
      '  <div class="meter__grid">',
      '    <div class="stat"><div class="stat__label">Ultimul index</div><div class="stat__value">' + RC.escape(last) + '</div></div>',
      '    <div class="stat"><div class="stat__label">Tipic</div><div class="stat__value">' + typicalLabel + '</div></div>',
      '    <div class="stat"><div class="stat__label">Perioadă</div><div class="stat__value">' + RC.escape(state.period) + '</div></div>',
      '  </div>',
      '  <div class="meter__form">',
      '    <label class="field"><span>Index nou</span><input class="citire-input" type="number" inputmode="decimal" step="any" min="0" value=""' + (disabled ? " disabled" : "") + '></label>',
      '    <p class="hint" data-role="citire-hint">' + (state.state === "upcoming" ? "Fereastra nu este deschisă." : (state.reported ? "Corectează perioada " + RC.escape(state.period) + "." : "Introdu indexul citit.")) + '</p>',
      '    <div class="meter__actions"><span class="state" data-role="citire-state"></span>',
      '      <button class="primary citire-submit" type="button"' + (disabled ? " disabled" : "") + '>Trimite</button></div>',
      '  </div>',
      '</article>'
    ].join("");
  }

  function renderCitiri() {
    if (!config) {
      citiriEl.innerHTML = '<p class="muted">Nu există configurație.</p>';
      return;
    }
    var houseFilter = citiriHouseEl ? citiriHouseEl.value : "";
    var meters = (config.meters || []).filter(function (meter) {
      if (!meter || meter.reading_mode === "external") return false;
      return !houseFilter || (meter.house_id || "casa") === houseFilter;
    });
    citiriEl.innerHTML = meters.map(citireCard).join("") ||
      '<p class="muted">Niciun contor cu citire manuală în casa selectată.</p>';
  }

  function updateCitireCard(meter) {
    var card = citiriEl.querySelector('[data-citire-id="' + meter.id + '"]');
    if (!card) return;
    var input = card.querySelector(".citire-input");
    var hint = card.querySelector('[data-role="citire-hint"]');
    var stateEl = card.querySelector('[data-role="citire-state"]');
    var submit = card.querySelector(".citire-submit");
    var raw = input.value.trim().replace(",", ".");
    if (!raw) {
      hint.textContent = "Introdu indexul citit.";
      stateEl.textContent = "";
      submit.disabled = true;
      return;
    }
    var value = Number(raw);
    if (!isFinite(value) || value < 0) {
      hint.textContent = "Introdu un număr valid.";
      stateEl.textContent = "";
      submit.disabled = true;
      return;
    }
    var result = citireEvaluate(meter, value, false);
    var labels = { ok: "Valoare în interval.", warn: "Valoare neobișnuită; confirmă.", refuse: "Valoare refuzată; verifică indexul.", unknown: "Prima citire; intervalul se activează după.", rollover: "Index sub ultima valoare; confirmă resetarea.", invalid: "Valoare invalidă." };
    hint.textContent = labels[result.state] || "";
    stateEl.textContent = result.state === "ok" || result.state === "unknown" ? "OK" : (result.state === "warn" ? "Verifică" : "Blocat");
    stateEl.className = "state " + (result.state === "ok" || result.state === "unknown" ? "state--ok" : "state--warn");
    submit.disabled = result.state === "refuse" || result.state === "invalid" || result.state === "rollover";
  }

  function submitCitire(meter) {
    if (!client || !connected) {
      setStatus("Nu ești conectat la MQTT.", "err");
      return;
    }
    var card = citiriEl.querySelector('[data-citire-id="' + meter.id + '"]');
    if (!card) return;
    var input = card.querySelector(".citire-input");
    var raw = input.value.trim().replace(",", ".");
    var value = Number(raw);
    if (!raw || !isFinite(value) || value < 0) {
      setStatus("Index invalid.", "err");
      return;
    }
    var state = citirePeriod(meter);
    if (state.state === "upcoming") {
      setStatus("Fereastra nu este încă deschisă; reîncarcă lista de citiri.", "err");
      return;
    }
    var result = citireEvaluate(meter, value, false);
    if (result.state === "refuse" || result.state === "invalid" || result.state === "rollover") {
      setStatus("Citirea necesită corectare sau confirmare.", "err");
      return;
    }
    if (result.state === "warn" && !confirm("Valoarea este neobișnuită. O trimiți oricum?")) return;
    var baseline = baselineBefore(meter.id, state.period);
    var submission = RCSchema.buildSubmission({
      installation: installation,
      meter: meter,
      period: state.period,
      index: value,
      previous: baseline,
      submitted_by: "company_submitter",
      range_state: result.state,
      photo: false,
      late: Boolean(state.late),
      corrected: Boolean(state.reported),
      reset: false,
      client: { tz: "Europe/Bucharest", ua: "company_submitter" }
    });
    var body = JSON.stringify(submission);
    client.publish("meters/" + installation + "/submission/" + meter.id + "/" + state.period, body, { qos: 1, retain: true }, function (err) {
      if (err) {
        setStatus("Publicarea citirii a eșuat: " + err.message, "err");
        return;
      }
      client.publish("meters/" + installation + "/last/" + meter.id, body, { qos: 1, retain: true }, function (lastErr) {
        submissions[meter.id + "|" + state.period] = submission;
        if (submission.corrected) {
          client.publish("meters/" + installation + "/photo/" + meter.id + "/" + state.period, "", { qos: 1, retain: true });
        }
        renderHistory();
        renderCitiri();
        setStatus(lastErr ? "Citirea a fost publicată, dar pointerul last a eșuat." : "Citire publicată. Verifică tabul Companie; dacă lipsește propunerea HA, folosește „Reîncearcă HA” din istoric.", lastErr ? "warn" : "ok");
      });
    });
  }

  function renderAll() {
    renderHouses();
    renderEditor();
    renderCitiriHouseFilter();
    renderCitiri();
    notificationsEditor();
    renderJson();
    renderHistoryHouseFilter();
    renderHistory();
    renderProposals();
    renderCompanyStatus();
    renderResetMeters();
  }

  editor.addEventListener("input", function (event) {
    var input = event.target;
    var wrapper = input.closest("[data-meter-index]");
    if (!wrapper) return;
    var meter = config.meters[Number(wrapper.dataset.meterIndex)];
    if (!meter) return;
    if (input.hasAttribute("data-window-toggle")) return;
    var path = input.getAttribute("data-path");
    if (!path) return;
    setPath(meter, path, inputValue(input));
    if (path === "name") wrapper.querySelector("h2").textContent = input.value || meter.id;
    markDirty();
    renderJson();
  });

  editor.addEventListener("change", function (event) {
    var input = event.target;
    var wrapper = input.closest("[data-meter-index]");
    if (!wrapper) return;
    var meter = config.meters[Number(wrapper.dataset.meterIndex)];
    if (!meter) return;
    if (input.hasAttribute("data-window-toggle")) {
      meter.window = input.checked ? (meter.window || defaultWindow()) : null;
      markDirty();
      renderEditor();
      renderJson();
      return;
    }
    var path = input.getAttribute("data-path");
    if (!path) return;
    setPath(meter, path, inputValue(input));
    markDirty();
    renderJson();
    if (path === "reading_mode" || path === "visible" || path === "house_id") {
      renderCitiri();
    }
  });

  editor.addEventListener("click", function (event) {
    var target = event.target;
    if (target.classList.contains("remove-meter")) {
      var wrapper = target.closest("[data-meter-index]");
      var index = Number(wrapper.dataset.meterIndex);
      if (!config.meters[index]) return;
      if (!confirm("Ștergi contorul „" + (config.meters[index].name || config.meters[index].id) + "”?")) return;
      config.meters.splice(index, 1);
      markDirty();
      renderEditor();
      renderCitiri();
      renderResetMeters();
      renderJson();
    }
  });

  housesEl.addEventListener("input", function (event) {
    var input = event.target;
    var wrapper = input.closest("[data-house-index]");
    var path = input.getAttribute("data-house-path");
    if (!wrapper || !path || !config) return;
    var house = config.houses[Number(wrapper.dataset.houseIndex)];
    if (!house) return;
    house[path] = inputValue(input);
    if (path === "name") wrapper.querySelector("h2").textContent = input.value || house.id;
    markDirty();
    renderJson();
  });

  housesEl.addEventListener("change", function (event) {
    var input = event.target;
    var wrapper = input.closest("[data-house-index]");
    var path = input.getAttribute("data-house-path");
    if (!wrapper || !path || !config) return;
    var house = config.houses[Number(wrapper.dataset.houseIndex)];
    if (!house) return;
    house[path] = inputValue(input);
    markDirty();
    renderJson();
    if (path === "id" || path === "name") renderEditor();
  });

  housesEl.addEventListener("click", function (event) {
    var target = event.target;
    if (!target.classList.contains("remove-house")) return;
    var wrapper = target.closest("[data-house-index]");
    var index = Number(wrapper.dataset.houseIndex);
    var house = config && config.houses ? config.houses[index] : null;
    if (!house) return;
    var used = (config.meters || []).some(function (meter) { return meter.house_id === house.id; });
    if (used) {
      setStatus("Casa are contoare. Mută sau șterge contoarele întâi.", "err");
      return;
    }
    if (!confirm("Ștergi casa „" + (house.name || house.id) + "”?")) return;
    config.houses.splice(index, 1);
    markDirty();
    renderHouses();
    renderEditor();
    renderJson();
  });

  RC.$("add-house").addEventListener("click", function () {
    if (!config) config = { v: 1, schema: 3, installation: installation, houses: [], meters: [] };
    config.houses = config.houses || [];
    config.houses.push(blankHouse());
    markDirty();
    renderHouses();
    renderEditor();
    renderJson();
  });

  citiriEl.addEventListener("input", function (event) {
    if (!event.target.classList.contains("citire-input")) return;
    var card = event.target.closest("[data-citire-id]");
    var meter = card ? meterById(card.getAttribute("data-citire-id")) : null;
    if (meter) updateCitireCard(meter);
  });

  citiriEl.addEventListener("click", function (event) {
    if (!event.target.classList.contains("citire-submit")) return;
    var card = event.target.closest("[data-citire-id]");
    var meter = card ? meterById(card.getAttribute("data-citire-id")) : null;
    if (meter) submitCitire(meter);
  });

  RC.$("add-meter").addEventListener("click", function () {
    if (!config) config = { v: 1, schema: 3, installation: installation, houses: [fallbackHouse()], meters: [] };
    config.meters = config.meters || [];
    config.meters.push(blankMeter());
    markDirty();
    renderEditor();
    renderCitiri();
    renderResetMeters();
    renderJson();
  });

  RC.$("load-seed").addEventListener("click", function () {
    if (!confirm("Se încarcă exemplul generic peste configurația din editor. Nu publica dacă nu ești sigur.")) return;
    RC.loadSeed().then(function (seed) {
      seed.installation = installation;
      config = seed;
      dirty = true;
      renderAll();
      setStatus("Seed încărcat local. Verifică și apasă „Publică configurația”.", "warn");
    }).catch(function (err) {
      setStatus("Seed-ul nu a putut fi încărcat: " + err.message, "err");
    });
  });

  RC.$("copy-config").addEventListener("click", function () {
    if (!config || !navigator.clipboard) return;
    navigator.clipboard.writeText(JSON.stringify(config, null, 2)).then(function () {
      showToast("JSON copiat.", "ok");
    });
  });

  RC.$("copy-config").addEventListener("keydown", function (event) {
    if (event.key === "Enter") event.preventDefault();
  });

  RC.$("refresh-history").addEventListener("click", renderHistory);
  if (historyHouseEl) historyHouseEl.addEventListener("change", function () {
    historyHouseInitialized = true;
    try { localStorage.setItem("rc.admin.historyHouse", historyHouseEl.value); } catch (_) { /* private mode */ }
    renderHistory();
  });
  if (citiriHouseEl) citiriHouseEl.addEventListener("change", function () {
    citiriHouseInitialized = true;
    try { localStorage.setItem("rc.admin.reportingHouse", citiriHouseEl.value); } catch (_) { /* private mode */ }
    renderCitiri();
  });
  if (resetReportingEl) resetReportingEl.addEventListener("click", resetReporting);

  RC.$("make-invite").addEventListener("click", function () {
    var reporterToken = RC.$("reporter-token").value.trim();
    if (!reporterToken) {
      setStatus("Lipește tokenul raportorului.", "err");
      return;
    }
    var base = new URL("index.html", location.href).href;
    var url = base + "#installation=" + encodeURIComponent(installation) + "&token=" + encodeURIComponent(reporterToken);
    if (broker && broker !== RC.DEFAULTS.broker) url += "&broker=" + encodeURIComponent(broker);
    RC.$("invite").value = url;
    if (navigator.clipboard) navigator.clipboard.writeText(url);
    showToast("Link copiat. Tratează-l ca pe o parolă.", "warn");
  });

  RC.$("modal-close").addEventListener("click", function () {
    photoRequest += 1;
    modal.hidden = true;
    modalImg.removeAttribute("src");
  });

  proposalsEl.addEventListener("click", function (event) {
    var target = event.target;
    var row = target.closest("tr");
    if (target.classList.contains("approve-proposal")) {
      publishCompanyCommand(target.getAttribute("data-meter"), target.getAttribute("data-period"), "approve", row);
    } else if (target.classList.contains("suppress-proposal")) {
      publishCompanyCommand(target.getAttribute("data-meter"), target.getAttribute("data-period"), "suppress", row);
    }
  });

  historyEl.addEventListener("click", function (event) {
    var target = event.target;
    if (target.classList.contains("view-photo")) {
      viewPhoto(target.getAttribute("data-meter"), target.getAttribute("data-period"));
      return;
    }
    if (target.classList.contains("retry-ha")) {
      retryCompanyPreflight(target.getAttribute("data-meter"), target.getAttribute("data-period"));
    }
  });

  function viewPhoto(meterId, period) {
    if (!client) return;
    var topic = "meters/" + installation + "/photo/" + meterId + "/" + period;
    var requestId = ++photoRequest;
    modal.hidden = false;
    modalTitle.textContent = "Foto " + meterId + " · " + period;
    modalImg.removeAttribute("src");
    var done = false;

    function finish() {
      if (done) return;
      done = true;
      client.removeListener("message", onPhoto);
      client.unsubscribe(topic);
    }

    function onPhoto(incoming, payload) {
      if (requestId !== photoRequest || incoming !== topic) return;
      var base64 = payload ? payload.toString() : "";
      if (!base64) return;
      modalImg.src = "data:image/jpeg;base64," + base64;
      finish();
    }

    client.on("message", onPhoto);
    client.subscribe(topic, { qos: 1 });
    setTimeout(function () {
      if (done || requestId !== photoRequest) return;
      finish();
      modalTitle.textContent = "Foto " + meterId + " · " + period + " (indisponibilă)";
    }, 5000);
  }

  function normalizeConfig() {
    var out = RCSchema.normalize(config, installation);
    out.updated_at = new Date().toISOString();
    out.meters = (out.meters || []).map(function (meter) {
      delete meter._new;
      delete meter._newHouse;
      delete meter.reporting;
      delete meter.notify;
      delete meter.source;
      delete meter.forwarding;
      meter.reading_mode = meter.reading_mode === "external" ? "external" : "manual";
      meter.consumption_unit = meter.consumption_unit || meter.unit || "";
      meter.consumption_factor = meter.consumption_factor === null || meter.consumption_factor === undefined || meter.consumption_factor === "" ? 1 : meter.consumption_factor;
      meter.baseline = meter.baseline || { index: null, at: null };
      meter.thresholds = meter.thresholds || { mode: "absolute", warn_margin: 50, refuse_margin: 100 };
      meter.thresholds.warn_margin = meter.thresholds.warn_margin === null || meter.thresholds.warn_margin === "" ? 50 : meter.thresholds.warn_margin;
      meter.thresholds.refuse_margin = meter.thresholds.refuse_margin === null || meter.thresholds.refuse_margin === "" ? 100 : meter.thresholds.refuse_margin;
      meter.thresholds.warn_pct = meter.thresholds.warn_pct === null || meter.thresholds.warn_pct === "" ? 40 : meter.thresholds.warn_pct;
      meter.thresholds.refuse_pct = meter.thresholds.refuse_pct === null || meter.thresholds.refuse_pct === "" ? 80 : meter.thresholds.refuse_pct;
      meter.photo = meter.photo || { enabled: true, max_kb: 512 };
      meter.window = meter.window || null;
      return meter;
    });
    out.houses = (out.houses || []).map(function (house) {
      delete house._new;
      return house;
    });
    delete out.notifications;
    return out;
  }

  function validate(cfg) {
    var schemaError = RCSchema.validate(cfg);
    if (schemaError) return schemaError;
    if (!Array.isArray(cfg.meters) || !cfg.meters.length) return "Adaugă cel puțin un contor.";
    var ids = {};
    var timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (var i = 0; i < cfg.meters.length; i += 1) {
      var m = cfg.meters[i];
      if (!m || !m.id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(m.id)) return "ID invalid la contorul " + (i + 1) + " (litere mici, cifre, - și _).";
      if (ids[m.id]) return "ID duplicat: " + m.id;
      ids[m.id] = true;
      if (!m.name || !String(m.name).trim()) return "Contorul " + m.id + " nu are nume.";
      if (m.reading_mode !== "manual" && m.reading_mode !== "external") return "Modul de citire al contorului " + m.id + " este invalid.";
      if (!m.unit || !String(m.unit).trim()) return "Contorul " + m.id + " nu are unitate.";
      if (m.consumption_factor !== null && m.consumption_factor !== undefined && m.consumption_factor !== "" && !(Number(m.consumption_factor) > 0)) return "Factorul de consum al contorului " + m.id + " trebuie să fie pozitiv.";
      if (![0, 1, 2, 3].includes(Number(m.precision))) return "Precizia contorului " + m.id + " trebuie să fie 0–3.";
      if (m.typical_month !== null && m.typical_month !== undefined && !(Number(m.typical_month) > 0)) return "Consumul tipic al contorului " + m.id + " trebuie să fie pozitiv sau gol.";
      if (m.baseline && m.baseline.index !== null && m.baseline.index !== undefined && Number(m.baseline.index) < 0) return "Indexul de bază al contorului " + m.id + " este negativ.";
      if (m.thresholds) {
        if (m.thresholds.warn_margin !== null && m.thresholds.warn_margin !== undefined && Number(m.thresholds.warn_margin) < 0) return "Marja de avertizare a contorului " + m.id + " este negativă.";
        if (m.thresholds.refuse_margin !== null && m.thresholds.refuse_margin !== undefined && Number(m.thresholds.refuse_margin) < 0) return "Marja de refuz a contorului " + m.id + " este negativă.";
      }
      if (m.window) {
        var openDay = Number(m.window.open_day);
        var closeDay = Number(m.window.close_day);
        if (!(openDay >= 1 && openDay <= 31) || !(closeDay >= 1 && closeDay <= 31)) return "Zilele ferestrei contorului " + m.id + " trebuie să fie 1–31.";
        if (!timeRe.test(m.window.open_time || "") || !timeRe.test(m.window.close_time || "")) return "Orele ferestrei contorului " + m.id + " sunt invalide.";
        if (openDay === closeDay && (m.window.close_time || "") <= (m.window.open_time || "")) return "La contorul " + m.id + ", închiderea trebuie să fie după deschidere în aceeași zi.";
      }
      if (m.photo && m.photo.max_kb !== null && m.photo.max_kb !== undefined) {
        var maxKb = Number(m.photo.max_kb);
        if (!(maxKb >= 64 && maxKb <= 1024)) return "Limita foto a contorului " + m.id + " trebuie să fie 64–1024 KB.";
      }
    }
    return null;
  }

  RC.$("save").addEventListener("click", function () {
    if (!config) {
      setStatus("Nu există configurație de publicat. Încarcă seed sau adaugă un contor.", "err");
      return;
    }
    if (!client || !connected) {
      setStatus("Nu ești conectat la MQTT.", "err");
      return;
    }
    var cfg = normalizeConfig();
    var error = validate(cfg);
    if (error) {
      setStatus(error, "err");
      return;
    }
    dirty = false;
    setStatus("Se publică…");
    client.publish("meters/" + installation + "/config", JSON.stringify(cfg), { qos: 1, retain: true }, function (err) {
      if (err) {
        dirty = true;
        setStatus("Publicarea a eșuat: " + err.message, "err");
        return;
      }
      loadedOnce = true;
      lastPublishedAt = cfg.updated_at;
      if (dirty) {
        setStatus("Configurația publicată, dar există modificări mai noi nesalvate. Publică din nou.", "warn");
        return;
      }
      config = cfg;
      renderAll();
      setStatus("Publicat la " + new Date().toLocaleTimeString("ro-RO") + ".", "ok");
      showToast("Configurația a fost publicată.", "ok");
    });
  });
})();
