/* Report Consumption — shared browser helpers.
   No third-party code, no inline handlers. MQTT.js is vendored. */
(function () {
  "use strict";

  // The admin page can publish company commands. Do not allow an app page to
  // remain usable inside an attacker-controlled frame.
  if (window.top !== window.self) {
    try {
      window.top.location = window.location.href;
    } catch (err) {
      document.documentElement.style.display = "none";
    }
  }

  var RC = window.RC = {};

  RC.DEFAULTS = {
    broker: "wss://mqtt.flespi.io:443",
    installation: "casa"
  };

  RC.I18N = {
    ro: {
      disconnected: "Deconectat",
      connecting: "Se conectează…",
      connected: "Conectat",
      reconnecting: "Se reconectează…",
      error: "Eroare",
      setup_title: "Conectare",
      setup_hint: "Introdu datele primite de la administrator.",
      installation: "Instalație",
      token: "Token MQTT",
      broker: "Broker",
      advanced: "Avansat",
      connect: "Conectează",
      waiting: "Se așteaptă configurația…",
      waiting_hint: "Administratorul trebuie să publice configurația în MQTT.",
      admin: "Administrare",
      reporter: "Raportare",
      meters: "Contoare",
      typical: "Consum tipic",
      last_index: "Ultimul index",
      window: "Fereastră",
      no_window: "neconfigurată",
      no_window_anytime: "Fără fereastră — poți raporta oricând.",
      no_baseline: "fără valoare inițială",
      not_configured: "neconfigurat",
      report_soon: "Raportarea se activează în pasul următor.",
      config_title: "Configurație publicată",
      config_hint: "Aceasta este configurația citită din MQTT. Editarea și publicarea vin în pasul următor.",
      admin_setup_title: "Conectare administrator",
      admin_setup_hint: "Tokenul de administrare rămâne doar în această sesiune.",
      admin_token: "Token administrare",
      load_seed: "Încarcă seed",
      copy: "Copiază JSON",
      logout: "Deconectare",
      invalid_config: "Configurația din MQTT nu este validă.",
      empty_config: "Nu există încă o configurație publicată.",
      copied: "Copiat.",
      seed_loaded: "Seed încărcat local. Publicarea vine în pasul următor.",
      no_config: "Nu există configurație.",
      error_detail: "Detaliu",
      month: "lună",
      reset: "Resetează",
      open_until: "deschisă până la",
      window_closed_on: "închisă pe",
      window_opens_on: "se deschide pe",
      reported_for: "raportat pentru",
      expected: "Așteptat",
      normal: "normal",
      refuse: "refuz",
      expected_unavailable: "Interval estimat indisponibil: lipsește o citire anterioară sau consumul tipic.",
      period: "Perioadă",
      index_label: "Index nou",
      warn_confirm: "Am verificat valoarea; trimit oricum.",
      reset_confirm: "Contorul a fost resetat sau înlocuit.",
      photo_add: "Adaugă o poză (opțional)",
      photo_remove: "Elimină poza",
      photo: "Poză",
      photo_too_big: "Poza este peste limita configurată.",
      photo_preparing: "Se pregătește poza…",
      photo_ready: "Poza este pregătită.",
      photo_error: "Poza nu a putut fi pregătită:",
      queue_pending: "În așteptare; se trimite când revine conexiunea.",
      queue_photo_dropped: "Spațiul local este plin; pozele au fost eliminate din coadă.",
      queue_full: "Coada locală este plină; raportarea nu a putut fi salvată.",
      toast_queued: "Salvat local. Se trimite când revine conexiunea.",
      toast_queue_sent: "Raportările din așteptare au fost trimise.",
      queue_error: "Unele raportări nu au putut fi trimise; rămân în așteptare.",
      toast_sent: "Indexul a fost trimis.",
      toast_photo_failed: "Indexul a fost trimis, dar poza nu a putut fi încărcată.",
      toast_warn_confirm: "Confirmă valoarea neobișnuită înainte de trimitere.",
      toast_reset_confirm: "Confirmă resetarea contorului înainte de trimitere.",
      ok_hint: "Valoare în interval.",
      warn_hint: "Valoare neobișnuită; confirmă mai jos.",
      refuse_hint: "Valoare refuzată; verifică indexul.",
      first_hint: "Prima citire; intervalul se activează după această raportare.",
      rollover_hint: "Index sub ultima valoare; confirmă resetarea contorului.",
      reset_hint: "Resetare confirmată; valoarea devine noul punct de plecare.",
      invalid_hint: "Introdu un număr valid.",
      window_not_open: "Fereastra nu este încă deschisă.",
      no_visible_meters: "Niciun contor nu este configurat pentru raportare.",
      external_read: "Indexul acestui contor este preluat automat; nu se raportează din această pagină.",
      toast_last_failed: "Indexul a fost trimis, dar indicatorul „ultima citire” nu a putut fi actualizat. Se reîncearcă.",
      history: "Istoric",
      no_history: "Nicio raportare încă.",
      late: "întârziat",
      corrected: "corectat",
      correct: "Corectează",
      send: "Trimite indexul",
      sending: "Se trimite…",
      open_badge: "Deschis",
      late_badge: "Întârziat",
      upcoming_badge: "Se deschide",
      reported_badge: "Raportat"
    },
    en: {
      disconnected: "Disconnected",
      connecting: "Connecting…",
      connected: "Connected",
      reconnecting: "Reconnecting…",
      error: "Error",
      setup_title: "Connect",
      setup_hint: "Enter the details from your administrator.",
      installation: "Installation",
      token: "MQTT token",
      broker: "Broker",
      advanced: "Advanced",
      connect: "Connect",
      waiting: "Waiting for configuration…",
      waiting_hint: "The administrator must publish the configuration to MQTT.",
      admin: "Admin",
      reporter: "Report",
      meters: "Meters",
      typical: "Typical use",
      last_index: "Last index",
      window: "Window",
      no_window: "not configured",
      no_window_anytime: "No window — you can report anytime.",
      no_baseline: "no baseline",
      not_configured: "not configured",
      report_soon: "Reporting is enabled in the next step.",
      config_title: "Published configuration",
      config_hint: "This is the configuration read from MQTT. Editing and publishing come in the next step.",
      admin_setup_title: "Administrator sign-in",
      admin_setup_hint: "The admin token stays in this session only.",
      admin_token: "Admin token",
      load_seed: "Load seed",
      copy: "Copy JSON",
      logout: "Sign out",
      invalid_config: "The MQTT configuration is not valid.",
      empty_config: "No configuration has been published yet.",
      copied: "Copied.",
      seed_loaded: "Seed loaded locally. Publishing comes in the next step.",
      no_config: "No configuration.",
      error_detail: "Detail",
      month: "month",
      reset: "Reset",
      open_until: "open until",
      window_closed_on: "closed on",
      window_opens_on: "opens on",
      reported_for: "reported for",
      expected: "Expected",
      normal: "normal",
      refuse: "refused",
      expected_unavailable: "Expected range unavailable: no previous reading or typical consumption.",
      period: "Period",
      index_label: "New index",
      warn_confirm: "I checked the value; send it anyway.",
      reset_confirm: "The meter was reset or replaced.",
      photo_add: "Add a photo (optional)",
      photo_remove: "Remove photo",
      photo: "Photo",
      photo_too_big: "The photo is above the configured limit.",
      photo_preparing: "Preparing the photo…",
      photo_ready: "Photo ready.",
      photo_error: "The photo could not be prepared:",
      queue_pending: "Pending; it will be sent when the connection returns.",
      queue_photo_dropped: "Local storage is full; photos were dropped from the queue.",
      queue_full: "The local queue is full; the report could not be saved.",
      toast_queued: "Saved locally. It will be sent when the connection returns.",
      toast_queue_sent: "Pending reports were sent.",
      queue_error: "Some reports could not be sent; they remain queued.",
      toast_sent: "Index sent.",
      toast_photo_failed: "The index was sent, but the photo could not be uploaded.",
      toast_warn_confirm: "Confirm the unusual value before sending.",
      toast_reset_confirm: "Confirm the meter reset before sending.",
      ok_hint: "Value in range.",
      warn_hint: "Unusual value; confirm below.",
      refuse_hint: "Value refused; check the index.",
      first_hint: "First reading; the range activates after this report.",
      rollover_hint: "Index below the previous value; confirm the meter reset.",
      reset_hint: "Reset confirmed; the value becomes the new baseline.",
      invalid_hint: "Enter a valid number.",
      window_not_open: "The window is not open yet.",
      no_visible_meters: "No meter is configured for reporting.",
      external_read: "This meter is read automatically; it is not reported from this page.",
      toast_last_failed: "The index was sent, but the last-reading pointer could not be updated. It will be retried.",
      history: "History",
      no_history: "No reports yet.",
      late: "late",
      corrected: "corrected",
      correct: "Correct",
      send: "Send index",
      sending: "Sending…",
      open_badge: "Open",
      late_badge: "Late",
      upcoming_badge: "Opens soon",
      reported_badge: "Reported"
    }
  };

  RC.lang = function () {
    var stored = localStorage.getItem("rc.lang");
    return stored === "en" ? "en" : "ro";
  };

  RC.setLang = function (lang) {
    localStorage.setItem("rc.lang", lang === "en" ? "en" : "ro");
  };

  RC.t = function (key) {
    var dict = RC.I18N[RC.lang()] || RC.I18N.ro;
    return dict[key] || (RC.I18N.ro[key] || key);
  };

  RC.applyI18n = function () {
    document.documentElement.lang = RC.lang();
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = RC.t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", RC.t(el.getAttribute("data-i18n-placeholder")));
    });
  };

  RC.parseParams = function () {
    var hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    var search = new URLSearchParams(location.search);
    // A query-string token is never accepted and must not linger in the bar.
    if (search.has("token")) history.replaceState(null, "", location.pathname);
    return {
      // The bearer token is accepted only from the fragment. A query-string
      // token is sent to the static host before this code runs and is rejected.
      token: hash.get("token") || "",
      installation: hash.get("installation") || search.get("installation") || "",
      broker: hash.get("broker") || search.get("broker") || ""
    };
  };

  RC.stripUrl = function () {
    history.replaceState(null, "", location.pathname);
  };

  RC.escape = function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  RC.fmtIndex = function (value, precision) {
    if (value === null || value === undefined || value === "" || isNaN(Number(value))) {
      return "—";
    }
    var digits = Number.isFinite(Number(precision)) ? Number(precision) : 0;
    return new Intl.NumberFormat(RC.lang() === "en" ? "en-GB" : "ro-RO", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(Number(value));
  };

  RC.fmtDate = function (iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium" }).format(d);
  };

  RC.periodNow = function () {
    var d = new Date();
    var month = String(d.getMonth() + 1).padStart(2, "0");
    return d.getFullYear() + "-" + month;
  };

  RC.renderConnection = function (el, state, detail) {
    if (!el) return;
    el.classList.remove("pill--on", "pill--off", "pill--wait", "pill--err");
    var map = {
      on: ["pill--on", "connected"],
      off: ["pill--off", "disconnected"],
      wait: ["pill--wait", "reconnecting"],
      err: ["pill--err", "error"]
    };
    var chosen = map[state] || map.off;
    el.classList.add(chosen[0]);
    el.textContent = RC.t(chosen[1]);
    el.title = detail || "";
  };

  RC.connect = function (opts) {
    if (!window.mqtt) {
      if (opts.onFatal) opts.onFatal("MQTT.js missing");
      return null;
    }

    var topic = "meters/" + opts.installation + "/config";
    var client;
    try {
      client = window.mqtt.connect(opts.broker, {
        username: opts.token,
        clientId: "rc-" + opts.role + "-" + Math.random().toString(16).slice(2, 10),
        clean: true,
        reconnectPeriod: 4000,
        connectTimeout: 12000,
        keepalive: 30,
        protocolVersion: 4
      });
    } catch (err) {
      if (opts.onFatal) opts.onFatal("Broker invalid: " + err.message);
      return null;
    }

    function subscribe() {
      client.subscribe(topic, { qos: 1 }, function (err) {
        if (err && opts.onStatus) opts.onStatus("err", err.message);
      });
    }

    client.on("connect", function () {
      if (opts.onStatus) opts.onStatus("on");
      subscribe();
      if (opts.onConnect) opts.onConnect(client);
    });

    client.on("reconnect", function () {
      if (opts.onStatus) opts.onStatus("wait");
    });

    client.on("close", function () {
      if (opts.onStatus) opts.onStatus("off");
    });

    client.on("offline", function () {
      if (opts.onStatus) opts.onStatus("off");
    });

    client.on("error", function (err) {
      if (opts.onStatus) opts.onStatus("err", err && err.message);
    });

    client.on("message", function (incoming, payload) {
      if (incoming !== topic) return;
      var text = payload ? payload.toString() : "";
      if (!text) {
        if (opts.onConfig) opts.onConfig(null, null);
        return;
      }
      try {
        var config = JSON.parse(text);
        if (!config || config.v !== 1 || !Array.isArray(config.meters)) {
          throw new Error("invalid config shape");
        }
        if (opts.onConfig) opts.onConfig(null, config);
      } catch (err) {
        if (opts.onConfig) opts.onConfig(err, null);
      }
    });

    return client;
  };

  RC.loadSeed = function () {
    return fetch("config/seed.json", { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("seed fetch failed");
      return res.json();
    });
  };

  RC.$ = function (id) { return document.getElementById(id); };

  RC.show = function (el, visible) {
    if (el) el.hidden = !visible;
  };

  RC.onLangToggle = function (button) {
    button.textContent = RC.lang() === "ro" ? "EN" : "RO";
    button.addEventListener("click", function () {
      RC.setLang(RC.lang() === "ro" ? "en" : "ro");
      location.reload();
    });
  };

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {
        /* offline shell is optional; never block the page */
      });
    });
  }
})();
