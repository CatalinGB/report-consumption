#!/usr/bin/env node
"use strict";

/*
 * Mint the scoped Flespi tokens for Report Consumption.
 *
 * Reads the master token from ../grandpa-pager/.env (never prints it), creates
 * the three ACL tokens from tools/tokens.json under temporary names, verifies
 * every key, backs up .env.tokens, atomically writes the new keys, renames the
 * tokens to their final names, and only then deletes the old
 * report-consumption-* tokens.
 *
 * If anything fails before the switch, the old tokens and .env.tokens are left
 * usable. Only names, ids and key lengths are printed.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENV_IN = path.resolve(ROOT, "..", "grandpa-pager", ".env");
const ENV_OUT = path.resolve(ROOT, ".env.tokens");
const TOKENS = path.resolve(__dirname, "tokens.json");
const API = "https://flespi.io/platform/tokens";
const AUTH = "https://flespi.io/auth/info";
const PREFIX = "report-consumption-";
const ENV_NAME = {
  "report-consumption-reporter": "REPORT_CONSUMPTION_REPORTER_TOKEN",
  "report-consumption-admin": "REPORT_CONSUMPTION_ADMIN_TOKEN",
  "report-consumption-home": "REPORT_CONSUMPTION_HOME_TOKEN"
};

function readMaster() {
  const text = fs.readFileSync(ENV_IN, "utf8");
  const line = text.split(/\r?\n/).find((row) => row.startsWith("FLESPI_TOKEN="));
  if (!line) throw new Error("FLESPI_TOKEN not found in grandpa-pager/.env");
  const value = line.slice("FLESPI_TOKEN=".length).trim().replace(/^['"]|['"]$/g, "");
  if (!value) throw new Error("FLESPI_TOKEN is empty");
  return value;
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

function replaceEnvKeys(text, pairs) {
  const keys = new Set(pairs.map((pair) => pair[0]));
  const lines = text.split(/\r?\n/).filter(Boolean).filter((line) => !keys.has(line.split("=")[0]));
  for (const pair of pairs) lines.push(pair[0] + "=" + pair[1]);
  return lines.join("\n") + "\n";
}

function backupEnv() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(ROOT, "backups", "mint-tokens-" + stamp);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) { /* best effort */ }
  fs.copyFileSync(ENV_OUT, path.join(dir, "env.tokens"));
  fs.chmodSync(path.join(dir, "env.tokens"), 0o600);
  return dir;
}

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: "FlespiToken " + readMaster(),
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-flespi-app": "report-consumption-mint"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    json = null;
  }
  if (!response.ok) {
    const reason = json && json.errors ? JSON.stringify(json.errors) : response.statusText;
    throw new Error(method + " " + url + " -> " + response.status + " " + reason);
  }
  return json || {};
}

async function verifyToken(key, expectedId, expectedInfo) {
  const info = await api("GET", AUTH, null, key);
  const token = Array.isArray(info.result) ? info.result[0] : info.result;
  if (!token || String(token.id) !== String(expectedId)) {
    throw new Error("new token did not validate via /auth/info");
  }
  if (expectedInfo && token.info !== expectedInfo) {
    throw new Error("new token has unexpected name after /auth/info");
  }
  return token;
}

async function main() {
  const master = readMaster();
  if (!master) throw new Error("empty master token");

  const wanted = JSON.parse(fs.readFileSync(TOKENS, "utf8"));
  if (!Array.isArray(wanted) || !wanted.length) throw new Error("tools/tokens.json is empty");
  const envText = fs.readFileSync(ENV_OUT, "utf8");

  // Snapshot the old tokens before creating anything.
  const listing = await api("GET", API + "/all?fields=id,info");
  const previous = (listing.result || []).filter((token) => String(token.info || "").startsWith(PREFIX));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tempSpecs = wanted.map((spec, index) => {
    if (!spec || !spec.info) throw new Error("tools/tokens.json entry " + index + " has no info");
    return Object.assign({}, spec, { info: spec.info + "-next-" + index + "-" + stamp });
  });

  const createdResponse = await api(
    "POST",
    API + "?fields=id,info,key,access_type,origins,ttl,expire",
    tempSpecs
  );
  const createdResult = createdResponse.result || [];
  const byTempName = new Map(createdResult.map((token) => [token.info, token]));
  const createdIds = createdResult.map((token) => token.id).filter(Boolean);

  let envWritten = false;
  const created = [];

  try {
    for (let index = 0; index < wanted.length; index++) {
      const spec = wanted[index];
      const tempName = tempSpecs[index].info;
      const token = byTempName.get(tempName);
      if (!token || !token.key) throw new Error("no key returned for " + tempName);
      if (!token.id) throw new Error("no id returned for " + tempName);
      const env = ENV_NAME[spec.info];
      if (!env) throw new Error("no env name for " + spec.info);
      const item = { spec, token, env };
      created.push(item);
      await verifyToken(token.key, token.id, tempName);
    }

    const backup = backupEnv();
    console.log("backed up .env.tokens to " + backup);

    writeAtomic(ENV_OUT, replaceEnvKeys(envText, created.map((item) => [item.env, item.token.key])));
    envWritten = true;

    for (const item of created) {
      await api(
        "PUT",
        API + "/" + encodeURIComponent(item.token.id) + "?fields=id,info",
        { info: item.spec.info }
      );
      await verifyToken(item.token.key, item.token.id, item.spec.info);
    }
  } catch (err) {
    const rollbackErrors = [];
    if (envWritten) {
      try { writeAtomic(ENV_OUT, envText); }
      catch (restoreErr) { rollbackErrors.push("restore .env.tokens: " + restoreErr.message); }
    }
    if (!rollbackErrors.length) {
      for (const id of createdIds) {
        try {
          await api("DELETE", API + "/" + encodeURIComponent(id));
          console.log("removed new token id=" + id + " after a failed mint");
        } catch (deleteErr) {
          rollbackErrors.push("remove new token id=" + id + ": " + deleteErr.message);
        }
      }
    } else {
      rollbackErrors.push("kept the new tokens because .env.tokens could not be restored");
    }
    if (rollbackErrors.length) console.error("rollback warning: " + rollbackErrors.join("; "));
    throw err;
  }

  console.log("created tokens:");
  for (const item of created) {
    console.log(
      "  " + item.spec.info +
      " id=" + item.token.id +
      " access_type=" + item.token.access_type +
      " origins=" + JSON.stringify(item.token.origins) +
      " key_len=" + String(item.token.key).length
    );
  }
  console.log("wrote", ENV_OUT, "mode 600 (contents not printed)");

  let cleanupFailed = false;
  for (const token of previous) {
    try {
      await api("DELETE", API + "/" + encodeURIComponent(token.id));
      console.log("removed previous token:", token.info, "id=" + token.id);
    } catch (err) {
      cleanupFailed = true;
      console.error("warning: could not remove previous token", token.info, "id=" + token.id + ": " + err.message);
    }
  }
  if (cleanupFailed) {
    console.error("mint finished, but some previous tokens remain; remove them in the Flespi panel.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("token mint failed:", err.message);
  process.exit(1);
});
