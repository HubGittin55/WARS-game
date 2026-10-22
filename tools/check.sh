#!/usr/bin/env bash
# Everything that must pass before you call a change good.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "── syntax ──"
for f in src/*.js tools/*.js; do node --check "$f"; done
echo "ok"
echo
node tools/smoke.js
echo
node tools/pressure.js 180 11
echo
node tools/playtest.js 300