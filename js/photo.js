/* Report Consumption — optional meter photo preparation.
   Resizes and compresses in the browser before anything is published. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RCPhoto = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_MAX_KB = 512;
  var MAX_EDGE = 1280;

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("image could not be decoded"));
      };
      img.src = url;
    });
  }

  function fit(width, height, maxEdge) {
    var longest = Math.max(width, height);
    if (longest <= maxEdge) return { width: width, height: height };
    var scale = maxEdge / longest;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  function draw(img, size) {
    var canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, size.width, size.height);
    return canvas;
  }

  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error("image encoding failed"));
        else resolve(blob);
      }, "image/jpeg", quality);
    });
  }

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || "");
        var comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = function () {
        reject(new Error("image could not be read"));
      };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Prepare a photo for MQTT: JPEG, no EXIF, max edge 1280, under maxKb.
   * @param {File} file
   * @param {number} maxKb
   */
  function prepare(file, maxKb) {
    var limit = Number(maxKb) > 0 ? Number(maxKb) : DEFAULT_MAX_KB;
    return loadImage(file).then(function (img) {
      var size = fit(img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_EDGE);
      var quality = 0.82;
      var attempts = 0;

      function attempt() {
        return toBlob(draw(img, size), quality).then(function (blob) {
          if (blob.size <= limit * 1024 || quality <= 0.32 || attempts >= 6) {
            return toBase64(blob).then(function (base64) {
              return {
                base64: base64,
                type: "image/jpeg",
                bytes: blob.size,
                width: size.width,
                height: size.height,
                overLimit: blob.size > limit * 1024
              };
            });
          }
          attempts += 1;
          if (attempts >= 4) {
            size = fit(size.width, size.height, Math.round(Math.max(size.width, size.height) * 0.8));
          }
          quality -= 0.1;
          return attempt();
        });
      }

      return attempt();
    });
  }

  return {
    prepare: prepare,
    DEFAULT_MAX_KB: DEFAULT_MAX_KB,
    MAX_EDGE: MAX_EDGE
  };
});
