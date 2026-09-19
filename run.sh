#!/usr/bin/env bash
# WARS — launcher. The game is pure file:// HTML, so this just opens index.html.
#   ./run.sh            open in your default browser
#   ./run.sh --serve    serve over HTTP instead (http://localhost:8080)
#   ./run.sh --serve 9000
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--serve" ]]; then
  port="${2:-8080}"
  echo "WARS on http://localhost:${port}   (ctrl-c to stop)"
  if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$port"
  elif command -v python >/dev/null 2>&1; then exec python -m SimpleHTTPServer "$port"
  elif command -v npx >/dev/null 2>&1; then exec npx --yes http-server -p "$port"
  else echo "Need python3 or npx to serve." >&2; exit 1; fi
fi

url="file://$(pwd)/index.html"
for opener in xdg-open open gnome-open kde-open6 plasmopen; do
  if command -v "$opener" >/dev/null 2>&1; then exec "$opener" "$url"; fi
done

echo "No browser launcher found. Open this manually:"
echo "  $url"