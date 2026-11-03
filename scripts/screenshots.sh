#!/usr/bin/env bash
# Smoke screenshots of the level screen in headless Firefox (output: .tmp/shots/).
# Starts a time-limited http.server, takes one shot per case, stops the server.
# Usage: scripts/screenshots.sh            (needs python3 + firefox)
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8765}
OUT=.tmp/shots; PROF=.tmp/ffprof
mkdir -p "$OUT" "$PROF"
# no caching, so edited modules are always reloaded
printf 'user_pref("browser.cache.disk.enable", false);\nuser_pref("browser.cache.memory.enable", false);\n' > "$PROF/user.js"
timeout 300 python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 0.3; done
U="http://localhost:$PORT/index.html"
shot() {
  timeout 90 firefox --headless --no-remote -profile "$PROF" --window-size 1200,800 \
    --screenshot "$PWD/$OUT/$1.png" "$U?$2" >/dev/null 2>&1
  [ -s "$OUT/$1.png" ] && echo "ok   $1" || echo "FAIL $1"
}
shot edit   "level=1"
shot step   "level=3&code=repeat%203%0A%20%20move%0A%20%20left%0Aend&run=1"
shot bump   "level=2&code=move%0Amove%0Amove&run=all"
shot locked "level=1&code=move%202%0Aright&run=all"
shot win    "level=8&solve=1"
