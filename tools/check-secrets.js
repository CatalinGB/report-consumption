#!/usr/bin/env node
"use strict";

/*
 * Secret guard for Report Consumption.
 *
 * Modes:
 *   --staged    scan files in the git index (used by .githooks/pre-commit)
 *   --tracked   scan every tracked file (used by CI)
 *   --history   scan all commits for known secret values and forbidden paths
 *   --file P    scan one file (used by the guard's own tests)
 *   --self-test verify that --staged reads the index, not the working tree
 *
 * Known secret values are read from .env, .env.tokens and (if present)
 * ../grandpa-pager/.env. They are never printed: findings name the path and the
 * reason, not the value.
 */

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = process.cwd();
const args = process.argv.slice(2);
const MODE_STAGED = args.includes("--staged");
const MODE_HISTORY = args.includes("--history");
const MODE_SELF_TEST = args.includes("--self-test");
const FILE_ARG = (() => {
  const i = args.indexOf("--file");
  return i >= 0 ? args[i + 1] : null;
})();
const MODE_TRACKED = !MODE_STAGED && !MODE_SELF_TEST && !FILE_ARG &&
  (args.includes("--tracked") || !MODE_HISTORY);

const FORBIDDEN_NAMES = [
  ".env",
  ".env.tokens",
  "ha/flespi-bridge.conf",
  "secrets.yaml",
  "secrets.yml"
];

const SKIP_GENERIC = new Set([
  "package-lock.json",
  "mqtt.min.js",
  "check-secrets.js",
  "flespi-mint-tokens.js",
  "flespi-rotate-home.js",
  "render-flespi-bridge.js",
  "e2e-flespi.js"
]);

function isForbiddenPath(file) {
  const normalized = file.replace(/\\/g, "/");
  const base = path.basename(normalized);
  if (base === ".env.example" || base === ".env.sample" || base === ".env.template") return false;
  if (FORBIDDEN_NAMES.includes(normalized)) return true;
  if (base === ".env") return true;
  if (base.startsWith(".env.")) return true;
  if (base === "flespi-bridge.conf") return true;
  if (/\.private\.ya?ml$/i.test(base)) return true;
  if (/^secrets\.ya?ml$/i.test(base)) return true;
  return false;
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function readKnownSecrets() {
  const files = [
    path.join(ROOT, ".env"),
    path.join(ROOT, ".env.tokens"),
    path.join(ROOT, ".env.ntfy"),
    path.resolve(ROOT, "..", "grandpa-pager", ".env")
  ];
  const values = new Set();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^[A-Z0-9_]*(TOKEN|SECRET|PASS|PASSWORD|KEY|API|NTFY)[A-Z0-9_]*\s*=\s*(.+)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^['"]|['"]$/g, "");
      if (value.length >= 16) values.add(value);
    }
  }
  return [...values];
}

function readPiiPatterns() {
  const file = process.env.RC_PII_DENYLIST ||
    path.resolve(ROOT, "..", "report-consumption-private", "pii-denylist.txt");
  if (!fs.existsSync(file)) return [];
  const values = fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  return values.map((value) => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, "iu");
  });
}

const PII_PATTERNS = readPiiPatterns();

function scanText(file, text, knownSecrets) {
  const findings = [];
  const normalized = file.replace(/\\/g, "/");
  const basename = path.basename(normalized);
  const genericAllowed = !SKIP_GENERIC.has(basename) && !normalized.startsWith("tests/fixtures/");

  if (isForbiddenPath(normalized)) {
    findings.push({ file: normalized, reason: "forbidden secret-bearing path" });
    return findings;
  }

  for (const secret of knownSecrets) {
    if (text.includes(secret)) {
      findings.push({ file: normalized, reason: "contains a known local secret value" });
      break;
    }
  }

  for (const pattern of PII_PATTERNS) {
    if (pattern.test(text)) {
      findings.push({ file: normalized, reason: "matches the private PII denylist" });
      break;
    }
  }

  if (!genericAllowed) return findings;

  if (/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text)) {
    findings.push({ file: normalized, reason: "private key block" });
  }

  const patterns = [
    { re: /(FlespiToken|Bearer)\s+[A-Za-z0-9._~+/=-]{20,}/, reason: "bearer/Flespi token literal" },
    { re: /[A-Z0-9_]*(TOKEN|SECRET|PASS|PASSWORD|API[_-]?KEY)[A-Z0-9_]*\s*=\s*["']?[A-Za-z0-9_-]{16,}/, reason: "token/secret assignment" },
    { re: /remote_username\s+[A-Za-z0-9]{20,}/, reason: "bridge token literal" },
    { re: /(api[_-]?key|secret|pass(word)?|token)\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{16,}["']/i, reason: "credential assignment" }
  ];
  for (const pattern of patterns) {
    if (pattern.re.test(text)) {
      findings.push({ file: normalized, reason: pattern.reason });
    }
  }

  if (/(token|flespi|\.env)/i.test(basename) && /[A-Za-z0-9]{64}/.test(text)) {
    findings.push({ file: normalized, reason: "64-char token in a token-named file" });
  }

  return findings;
}

function scanBuffer(file, buffer) {
  if (buffer.length > 2 * 1024 * 1024 || isBinary(buffer)) return [];
  return scanText(file, buffer.toString("utf8"), readKnownSecrets());
}

function scanFilePath(file) {
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (err) {
    return [];
  }
  return scanBuffer(file, buffer);
}

function scanStagedBlob(file) {
  if (isForbiddenPath(file)) {
    return [{ file: file.replace(/\\/g, "/"), reason: "forbidden secret-bearing path" }];
  }
  let buffer;
  try {
    buffer = execFileSync("git", ["show", ":" + file], {
      cwd: ROOT,
      maxBuffer: 4 * 1024 * 1024
    });
  } catch (err) {
    return [];
  }
  return scanBuffer(file, buffer);
}

function listStaged() {
  return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z"], {
    cwd: ROOT,
    encoding: "utf8"
  }).split("\0").filter(Boolean);
}

function listTracked() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0").filter(Boolean);
}

function scanHistory(knownSecrets) {
  const findings = [];
  const commits = execFileSync("git", ["rev-list", "--all"], { cwd: ROOT, encoding: "utf8" })
    .split(/\r?\n/).filter(Boolean);

  // Forbidden paths anywhere in history.
  const names = execFileSync("git", ["log", "--all", "--name-only", "--pretty=format:"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024
  }).split(/\r?\n/).filter(Boolean);
  for (const name of names) {
    if (isForbiddenPath(name)) findings.push({ file: "history:" + name, reason: "secret-bearing path in git history" });
  }

  // Known secret values anywhere in history. Read the patch stream once.
  if (knownSecrets.length) {
    const patch = execFileSync("git", ["log", "--all", "-p", "--format=commit:%H", "--", "."], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024
    });
    let commit = "unknown";
    for (const line of patch.split(/\r?\n/)) {
      if (line.startsWith("commit:")) {
        commit = line.slice("commit:".length).trim();
        continue;
      }
      for (const secret of knownSecrets) {
        if (line.includes(secret)) {
          findings.push({ file: "history:commit " + commit, reason: "known secret value in git history" });
          break;
        }
      }
      for (const pattern of PII_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({ file: "history:commit " + commit, reason: "matches the private PII denylist in git history" });
          break;
        }
      }
    }
  }

  return findings;
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rc-secret-guard-"));
  const git = (gitArgs) => execFileSync("git", gitArgs, { cwd: tmp, encoding: "utf8" });
  const stagedScan = () => spawnSync(process.execPath, [__filename, "--staged"], {
    cwd: tmp,
    encoding: "utf8",
    timeout: 30000
  });
  const leak = 'API_KEY = "fake_test_value_1234567890"\n';

  try {
    git(["init", "-q"]);
    fs.writeFileSync(path.join(tmp, "leak.txt"), leak);
    git(["add", "leak.txt"]);

    const blocked = stagedScan();
    if (blocked.error) throw blocked.error;
    if (blocked.status !== 1) {
      throw new Error("--staged did not block a secret present in the index");
    }

    // Index clean, working tree dirty: --staged must still pass.
    fs.writeFileSync(path.join(tmp, "leak.txt"), "clean\n");
    git(["add", "leak.txt"]);
    fs.writeFileSync(path.join(tmp, "leak.txt"), leak);

    const clean = stagedScan();
    if (clean.error) throw clean.error;
    if (clean.status !== 0) {
      throw new Error("--staged scanned the working tree instead of the index");
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  console.log("Secret guard self-test: clean (staged mode reads the git index).");
}

function main() {
  if (MODE_SELF_TEST) {
    runSelfTest();
    return;
  }

  const knownSecrets = readKnownSecrets();
  let findings = [];

  if (FILE_ARG) {
    findings = scanFilePath(FILE_ARG);
  } else if (MODE_STAGED) {
    for (const file of listStaged()) findings = findings.concat(scanStagedBlob(file));
  } else if (MODE_TRACKED) {
    for (const file of listTracked()) findings = findings.concat(scanFilePath(file));
  }

  if (MODE_HISTORY) findings = findings.concat(scanHistory(knownSecrets));

  const unique = new Map();
  for (const finding of findings) {
    const key = finding.file + "|" + finding.reason;
    if (!unique.has(key)) unique.set(key, finding);
  }

  if (unique.size) {
    console.error("Secret guard: blocked.");
    for (const finding of unique.values()) {
      console.error("  " + finding.file + " — " + finding.reason);
    }
    console.error("Remove the secret from the staged content, working tree, or history before committing.");
    process.exit(1);
  }

  const scope = [FILE_ARG ? "file" : MODE_STAGED ? "staged" : MODE_TRACKED ? "tracked" : "",
    MODE_HISTORY ? "history" : ""].filter(Boolean).join(" + ");
  console.log("Secret guard: clean (" + scope + ").");
}

try {
  main();
} catch (err) {
  console.error("Secret guard failed:", err.message);
  process.exit(1);
}
