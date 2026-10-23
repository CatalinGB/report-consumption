"use strict";

/*
 * Small ntfy.sh client shared by the CLI and the MQTT listener.
 *
 * The topic is a local secret. It lives in `.env.ntfy` (mode 600, gitignored)
 * and is never printed by these tools.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.ntfy");

function readEnvFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function loadConfig() {
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error(".env.ntfy is missing; run the local setup first");
  }
  const env = readEnvFile(ENV_FILE);
  const topic = env.NTFY_TOPIC || "";
  const url = env.NTFY_URL || "";
  if (!topic || !url) {
    throw new Error(".env.ntfy must contain NTFY_TOPIC and NTFY_URL");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    throw new Error("NTFY_URL must use https (http is allowed only for localhost)");
  }
  const urlTopic = parsed.pathname.replace(/^\/+|\/+$/g, "");
  if (urlTopic && urlTopic !== topic) {
    throw new Error("NTFY_TOPIC and NTFY_URL point to different topics");
  }
  return {
    topic,
    publishUrl: parsed.origin + "/"
  };
}

function normalizePriority(value) {
  const names = { min: 1, low: 2, default: 3, high: 4, max: 5 };
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return undefined;
  if (Object.prototype.hasOwnProperty.call(names, text)) return names[text];
  const number = Number(text);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : undefined;
}

async function publish({ title, message, priority, tags, url, actionLabel }) {
  const config = loadConfig();
  const body = {
    topic: config.topic,
    message: String(message == null ? "" : message)
  };
  if (title) body.title = String(title);
  const normalizedPriority = normalizePriority(priority);
  if (normalizedPriority != null) body.priority = normalizedPriority;
  if (tags) {
    body.tags = Array.isArray(tags)
      ? tags
      : String(tags).split(",").map((tag) => tag.trim()).filter(Boolean);
  }
  if (url) {
    const parsedClick = new URL(String(url));
    if (parsedClick.search || parsedClick.hash) {
      throw new Error("notification URL must not contain a query string or fragment");
    }
    body.click = String(url);
    body.actions = [{
      action: "view",
      label: String(actionLabel || "Open link"),
      url: String(url)
    }];
  }

  const response = await fetch(config.publishUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error("ntfy publish failed: HTTP " + response.status + " " + detail.slice(0, 200));
  }
  return response.json();
}

module.exports = { loadConfig, publish };
