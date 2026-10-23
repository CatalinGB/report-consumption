#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit tools/check-secrets.js
echo "Installed git hooks from .githooks (pre-commit secret scan)."
echo "Run: node tools/check-secrets.js --tracked --history"
