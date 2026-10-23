#!/usr/bin/env node
"use strict";

/*
 * Send one notification to the local ntfy.sh topic.
 *
 * Usage:
 *   node tools/ntfy-notify.js --title "Test" --message "Hello" [--priority high] [--tags bell] [--url https://...]
 *
 * The topic comes from `.env.ntfy` and is not accepted from the command line,
 * so it cannot accidentally end up in shell history.
 */

const { publish } = require("./ntfy");

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (value == null || value.startsWith("--")) {
      values[name] = true;
    } else {
      values[name] = value;
      i += 1;
    }
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const message = args.message || args._ || "";
  if (!message) {
    throw new Error("usage: node tools/ntfy-notify.js --message \"...\" [--title ...]");
  }
  await publish({
    title: args.title || "Report consumption",
    message,
    priority: args.priority,
    tags: args.tags,
    url: args.url,
    actionLabel: args["action-label"] || args.action_label
  });
  console.log("ntfy notification sent");
}

main().catch((err) => {
  console.error("ntfy notification failed: " + err.message);
  process.exit(1);
});
