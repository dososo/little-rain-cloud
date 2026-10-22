#!/bin/zsh
# Render the six social covers (day/night x 3:4, 4:3, 16:9) from a running local server.
# usage: tools/covers.sh [base_url=http://127.0.0.1:8765] [out_dir=release/covers]
BASE=${1:-http://127.0.0.1:8765}
OUT=${2:-"$(dirname $0)/../release/covers"}
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROF=$(mktemp -d)
mkdir -p "$OUT"
DAY="&auto=1&call=12&freeze=13.5&cover=day"
NIGHT="&auto=1&stop=14&go=27&night=16&freeze=29.3&cover=night&yaw=1.34"
shot() {
  "$CHROME" --headless=new --use-angle=metal --enable-gpu --ignore-gpu-blocklist --hide-scrollbars \
    --window-size=$2 --user-data-dir="$PROF/$1" --virtual-time-budget=12000 \
    --screenshot="$OUT/$1.png" "$BASE/?$3" >/dev/null 2>&1
  echo "$1"
}
shot day_3x4    1080,1440 "$DAY&dist=12.5&pitch=0.44&shiftx=0.0&shifty=-0.17"
shot day_4x3    1440,1080 "$DAY&dist=10&pitch=0.42&shiftx=-0.1&shifty=-0.1"
shot day_16x9   1920,1080 "$DAY&dist=10&pitch=0.4&shiftx=-0.12&shifty=-0.08"
shot night_3x4  1080,1440 "$NIGHT&dist=10&pitch=0.45&shiftx=-0.16&shifty=-0.12&nocredit=1"
shot night_4x3  1440,1080 "$NIGHT&dist=10&pitch=0.42&shiftx=-0.18&shifty=-0.06&nocredit=1"
shot night_16x9 1920,1080 "$NIGHT&dist=10&pitch=0.4&shiftx=-0.2&shifty=-0.04&nocredit=1"
