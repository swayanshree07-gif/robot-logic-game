#!/usr/bin/env bash
# Captures README media from the real game in headless Firefox -> docs/media/.
# Stills: map, debugger, crew level, Lab. GIF: level 6 "Restock Run" played one
# command at a time (the known solution, unrolled, run for k = 0..36 commands).
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8766}; OUT=docs/media; TMP=.tmp/media; PROF=.tmp/ffprof-media
rm -rf "$PROF" "$TMP"; mkdir -p "$OUT" "$TMP/frames" "$PROF"
printf 'user_pref("browser.cache.disk.enable", false);\n' > "$PROF/user.js"
timeout 900 python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!; trap 'kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 20); do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 0.3; done
U="http://localhost:$PORT/index.html"
shot() { timeout 90 firefox --headless --no-remote -profile "$PROF" --window-size 1200,800 \
  --screenshot "$PWD/$1" "$U?$2" >/dev/null 2>&1; [ -s "$1" ] && echo "ok $1" || echo "FAIL $1"; }
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))'; }
# solve a few levels first so the map shows stars
shot "$TMP/warm1.png" "level=1&solve=1"; shot "$TMP/warm2.png" "level=9&solve=1"
shot "$TMP/map.png"    "map=1"
shot "$TMP/debug.png"  "level=6&code=$(printf 'repeat 4\n  move 2\n  grab\n  right\n  move\n  drop\n  right\n  right\n  move\n  right\nend' | enc)&bp=5&run=all"
shot "$TMP/blocks.png" "level=6&mode=blocks&code=$(printf 'repeat 4\n  move 2\n  grab\n  right\n  move\n  drop\n  right\n  right\n  move\n  right\nend' | enc)&bp=5&run=all"
shot "$TMP/crew.png"   "level=33&solve=1"
shot "$TMP/hint.png"   "level=10&hint=2&cb=1"
shot "$TMP/floors.png" "level=16&floor=3&solve=1"
# GIF frames
BODY=(move move grab right move drop right right move right)
FLAT=(); for _ in 1 2 3 4; do FLAT+=("${BODY[@]}"); done
for k in $(seq 0 ${#FLAT[@]}); do
  f=$(printf '%s/frames/f%02d.png' "$TMP" "$k")
  if [ "$k" = 0 ]; then shot "$f" "level=6"; else
    code=$(printf '%s\n' "${FLAT[@]:0:$k}" | enc); shot "$f" "level=6&code=$code&run=all"; fi
done
# Lab last: the open editor view persists in the profile and would cover later shots
timeout 90 firefox --headless --no-remote -profile "$PROF" --window-size 1200,800 \
  --screenshot "$PWD/$TMP/lab.png" "$U#lab" >/dev/null 2>&1 && echo "ok lab"
