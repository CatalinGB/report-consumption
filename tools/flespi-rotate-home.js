#!/usr/bin/env node
"use strict";

/*
 * Verify and rotate ONLY the report-consumption-home token.
 *
 * Reads the master token from ../grandpa-pager/.env (never prints it), lists
 * tokens via the Platform API, validates the current home key via /auth/info,
 * creates a fresh token with a temporary name, verifies it, backs up
 * .env.tokens and the rendered bridge, switches both local files atomically,
 * renames the new token, and only then deletes the old home tokens.
 *
 * If anything fails before the switch, the old token and local files are left
 * usable. Prints ids, ACLs and key lengths only, never key values.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENV_IN = path.resolve(ROOT, "..", "grandpa-pager", ".env");
const ENV_OUT = path.resolve(ROOT, ".env.tokens");
const BRIDGE_OUT = path.join(ROOT, "ha", "flespi-bridge.conf");
const BRIDGE_EXAMPLE = path.join(ROOT, "ha", "flespi-bridge.conf.example");
const PLATFORM = "https://flespi.io/platform/tokens";
const AUTH = "https://flespi.io/auth/info";
const NAME = "report-consumption-home";
const HOME_ACL = [
  { uri: "mqtt", topic: "meters/casa/#", actions: ["subscribe"] },
  { uri: "mqtt", topic: "meters/casa/status/#", actions: ["publish"] }
];

function readMaster() {
  const text = fs.readFileSync(ENV_IN, "utf8");
  const line = text.split(/\r?\n/).find((row) => row.startsWith("FLESPI_TOKEN="));
  if (!line) throw new Error("FLESPI_TOKEN not found");
  return line.slice("FLESPI_TOKEN=".length).trim().replace(/^['"]|['"]$/g, "");
}

function readHomeKey() {
  const text = fs.readFileSync(ENV_OUT, "utf8");
  const line = text.split(/\r?\n/).find((row) => row.startsWith("REPORT_CONSUMPTION_HOME_TOKEN="));
  if (!line) throw new Error("home token not found in .env.tokens");
  return line.slice("REPORT_CONSUMPTION_HOME_TOKEN=".length).trim();
}

function replaceHomeKey(text, key) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith("REPORT_CONSUMPTION_HOME_TOKEN=")) {
      found = true;
      return "REPORT_CONSUMPTION_HOME_TOKEN=" + key;
    }
    return line;
  });
  if (!found) updated.push("REPORT_CONSUMPTION_HOME_TOKEN=" + key);
  return updated.join("\n") + "\n";
}

function writeAtomic(file, text) {
  const tmp = file + ".tmp-" + process.pid + "-" + Math.random().toString(16).slice(2, 8);
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch (_) { /* best effort */ }
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
    throw err;
  }
}

function backupFiles() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(ROOT, "backups", "rotate-home-" + stamp);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) { /* best effort */ }
  fs.copyFileSync(ENV_OUT, path.join(dir, "env.tokens"));
  fs.chmodSync(path.join(dir, "env.tokens"), 0o600);
  if (fs.existsSync(BRIDGE_OUT)) {
    fs.copyFileSync(BRIDGE_OUT, path.join(dir, "flespi-bridge.conf"));
    fs.chmodSync(path.join(dir, "flespi-bridge.conf"), 0o600);
  }
  return dir;
}

async function api(method, url, body, token) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: "FlespiToken " + token,
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-flespi-app": "report-consumption-rotate-home"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (err) { /* keep null */ }
  if (!response.ok) {
    const reason = json && json.errors ? JSON.stringify(json.errors) : response.statusText;
    throw new Error(method + " " + url + " -> " + response.status + " " + reason);
  }
  return json || {};
}

function aclSummary(access) {
  if (!access || !Array.isArray(access.acl)) return [];
  return access.acl.map((ace) => ({ uri: ace.uri, topic: ace.topic, actions: ace.actions }));
}

async function verifyToken(key, expectedId, expectedInfo) {
  const info = await api("GET", AUTH, null, key);
  const token = Array.isArray(info.result) ? info.result[0] : info.result;
  if (!token || String(token.id) !== String(expectedId)) {
    throw new Error("new home token did not validate via /auth/info");
  }
  if (expectedInfo && token.info !== expectedInfo) {
    throw new Error("new home token has unexpected name after /auth/info");
  }
  return token;
}

async function main() {
  const master = readMaster();
  const oldHome = readHomeKey();
  const envText = fs.readFileSync(ENV_OUT, "utf8");
  const bridgeExists = fs.existsSync(BRIDGE_OUT);
  const bridgeText = bridgeExists ? fs.readFileSync(BRIDGE_OUT, "utf8") : null;

  console.log("=== token list (safe fields only) ===");
  const list = await api(
    "GET",
    PLATFORM + "/all?fields=id,info,access,access_type,origins,enabled,expire,ttl",
    null,
    master
  );
  const homes = (list.result || []).filter((t) => t.info === NAME);
  for (const t of homes) {
    console.log(JSON.stringify({
      id: t.id,
      info: t.info,
      access_type: t.access_type,
      origins: t.origins,
      enabled: t.enabled,
      expire: t.expire,
      ttl: t.ttl,
      acl: aclSummary(t.access)
    }));
  }
  if (!homes.length) console.log("no token named " + NAME + " found");

  console.log("=== current home key /auth/info ===");
  try {
    const info = await api("GET", AUTH, null, oldHome);
    const t = Array.isArray(info.result) ? info.result[0] : info.result;
    console.log(JSON.stringify({
      valid: true,
      id: t && t.id,
      info: t && t.info,
      access_type: t && t.access_type,
      origins: t && t.origins,
      enabled: t && t.enabled,
      expire: t && t.expire,
      ttl: t && t.ttl,
      acl: aclSummary(t && t.access)
    }));
  } catch (err) {
    console.log("current home key check failed: " + err.message);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tempName = NAME + "-next-" + stamp;
  const created = await api(
    "POST",
    PLATFORM + "?fields=id,info,key,access_type,origins,expire,ttl,access",
    [{
      info: tempName,
      access: { type: 2, acl: HOME_ACL },
      origins: [],
      ttl: 31536000,
      expire: 0
    }],
    master
  );
  const token = (created.result || [])[0];
  const createdIds = (created.result || []).map((item) => item.id).filter(Boolean);
  let envWritten = false;
  let bridgeWritten = false;

  try {
    if (!token || !token.key) throw new Error("no key returned for the new home token");
    if (!token.id) throw new Error("no id returned for the new home token");

    await verifyToken(token.key, token.id, tempName);
    console.log(
      "created temporary home token id=" + token.id +
      " name=" + tempName +
      " key_len=" + String(token.key).length +
      " (key not printed)"
    );

    const backup = backupFiles();
    console.log("backed up .env.tokens" + (bridgeExists ? " and bridge config" : "") + " to " + backup);

    writeAtomic(ENV_OUT, replaceHomeKey(envText, token.key));
    envWritten = true;

    const example = fs.readFileSync(BRIDGE_EXAMPLE, "utf8");
    writeAtomic(BRIDGE_OUT, example.replace("<HOME_TOKEN>", token.key));
    bridgeWritten = true;

    await api(
      "PUT",
      PLATFORM + "/" + encodeURIComponent(token.id) + "?fields=id,info",
      { info: NAME },
      master
    );
    await verifyToken(token.key, token.id, NAME);
  } catch (err) {
    const rollbackErrors = [];
    if (envWritten) {
      try { writeAtomic(ENV_OUT, envText); }
      catch (restoreErr) { rollbackErrors.push("restore .env.tokens: " + restoreErr.message); }
    }
    if (bridgeWritten) {
      try {
        if (bridgeExists) writeAtomic(BRIDGE_OUT, bridgeText);
        else fs.unlinkSync(BRIDGE_OUT);
      } catch (restoreErr) {
        rollbackErrors.push("restore bridge config: " + restoreErr.message);
      }
    }
    if (!rollbackErrors.length) {
      for (const id of createdIds) {
        try {
          await api("DELETE", PLATFORM + "/" + encodeURIComponent(id), null, master);
          console.log("removed new token id=" + id + " after a failed rotation");
        } catch (deleteErr) {
          rollbackErrors.push("remove new token id=" + id + ": " + deleteErr.message);
        }
      }
    } else {
      rollbackErrors.push("kept the new token because local files could not be restored");
    }
    if (rollbackErrors.length) console.error("rollback warning: " + rollbackErrors.join("; "));
    throw err;
  }

  console.log("switched home token id=" + token.id + " name=" + NAME + " (key not printed)");

  let cleanupFailed = false;
  for (const t of homes) {
    if (String(t.id) === String(token.id)) continue;
    try {
      await api("DELETE", PLATFORM + "/" + encodeURIComponent(t.id), null, master);
      console.log("deleted old home token id=" + t.id);
    } catch (err) {
      cleanupFailed = true;
      console.error("warning: could not delete old home token id=" + t.id + ": " + err.message);
    }
  }
  if (cleanupFailed) {
    console.error("rotation finished, but some old home tokens remain; remove them in the Flespi panel.");
    process.exitCode = 1;
  }

  console.log("re-rendered " + BRIDGE_OUT + " (mode 600, token not printed)");
}

main().catch((err) => {
  console.error("home token rotation failed:", err.message);
  process.exit(1);
});
