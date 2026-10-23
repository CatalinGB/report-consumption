/* Report Consumption — service worker (PWA install + offline shell). */
var CACHE = "report-consumption-v12";
var ASSETS = [
  "./", "./index.html", "./admin.html",
  "./css/app.css",
  "./js/common.js", "./js/schema.js", "./js/period.js", "./js/anomaly.js", "./js/photo.js", "./js/reporter.js", "./js/admin.js",
  "./mqtt.min.js",
  "./manifest.webmanifest",
  "./config/seed.json",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"
];

/* Never cache a URL carrying a query string or fragment: an invite link would
   otherwise persist a token in Cache Storage. */
function cacheKey(url) {
  var u = new URL(url);
  if (u.origin === self.location.origin) {
    u.search = "";
    u.hash = "";
  }
  return u.href;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(ASSETS.map(function (asset) {
        return cache.add(asset).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(function () {
        var path = new URL(event.request.url).pathname;
        return caches.match(path.endsWith("/admin.html") ? "./admin.html" : "./index.html");
      })
    );
    return;
  }

  event.respondWith(
    caches.match(cacheKey(event.request.url)).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(cacheKey(event.request.url), copy).catch(function () {});
          });
        }
        return response;
      }).catch(function () {
        return caches.match(cacheKey(event.request.url));
      });
    })
  );
});
