#!/usr/bin/env bash
# Smoke screenshots of the level screen (incl. a paused breakpoint) in headless Firefox (output: .tmp/shots/).
# Starts a time-limited http.server, takes one shot per case, stops the server.
# Usage: scripts/screenshots.sh            (needs python3 + firefox)
# Shots can be limited by name: scripts/screenshots.sh blocks blkdbg
set -u
ONLY="$*"
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
  if [ $# -gt 0 ] && [ -n "${ONLY:-}" ] && ! [[ " $ONLY " == *" $1 "* ]]; then return; fi
  timeout 90 firefox --headless --no-remote -profile "$PROF" --window-size 1200,800 \
    --screenshot "$PWD/$OUT/$1.png" "$U?$2" >/dev/null 2>&1
  [ -s "$OUT/$1.png" ] && echo "ok   $1" || echo "FAIL $1"
}
# level numbers are positions in LEVELS: 1-8 World 1, 9-16 World 2, 17-24 World 3; id=proto-8 is a fixture with every tool unlocked
shot edit    "level=1"
shot step    "level=4&code=repeat%205%0A%20%20move%0A%20%20right%0Aend&run=1"
shot bump    "level=2&code=move%0Amove%0Amove%0Amove&run=all"
shot locked  "level=1&code=move%202%0Aright&run=all"
shot win     "level=9&solve=1"
shot colours "level=13"
shot carry   "level=5&code=move%202%0Agrab&run=all"
shot stairs  "level=4"
shot battery "level=7&code=move%207%0Aright%0Amove%202&run=all"
shot sweep   "level=8&solve=1"
shot restock "level=6&code=repeat%204%0A%20%20move%202%0A%20%20grab%0A%20%20right%0A%20%20move%0A%20%20drop%0A%20%20right%0A%20%20right%0A%20%20move%0A%20%20right%0Aend&bp=5&run=all"
shot debug   "id=proto-8&code=repeat%201%0A%20%20go%0Aend%0Agrab%0Amove%0Adrop%0Aright%0Aright%0Amove%204%0Adef%20go%0A%20%20move%202%0Aend&bp=11&run=all"
shot warn    "id=proto-8&code=move%202%0Agrab%0Adef%20spare%0A%20%20left%0Aend%0Arepeat%201%0A%20%20move%0Aend"
# block editor: a program shown as blocks while editing, and paused at a breakpoint inside a repeat
shot blocks  "id=proto-8&mode=blocks&code=move%202%0Agrab%0Adef%20spare%0A%20%20left%0Aend%0Arepeat%201%0A%20%20move%0Aend"
shot blkdbg  "level=6&mode=blocks&code=repeat%204%0A%20%20move%202%0A%20%20grab%0A%20%20right%0A%20%20move%0A%20%20drop%0A%20%20right%0A%20%20right%0A%20%20move%0A%20%20right%0Aend&bp=5&run=all"
shot blkbad  "level=1&mode=blocks&code=move%0Amvoe"
# World 2 test floors: a fixed route fails calibration on floor 2; the paint room; watching floor 3
shot calib   "level=9&code=move%0Agrab%0Amove%206%0Adrop&run=all"
shot paint   "level=13&solve=1"
shot floor3  "level=16&floor=3&solve=1"
# world map (last, so the wins from the solve=1 shots above show as stars in the profile's save)
shot map     "map=1"
shot w3memory "id=w3-8&solve=1&floor=1"
shot start   "x=1"
