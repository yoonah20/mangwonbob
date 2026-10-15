#!/usr/bin/env bash
# 종류 타일 PNG를 다시 만든다. 색이나 글꼴을 바꿨을 때만 돌리면 된다.
# 필요: Chromium (CHROMIUM 환경변수로 경로 지정 가능), 인터넷(구글 폰트)
set -euo pipefail
cd "$(dirname "$0")/.."
CHROMIUM="${CHROMIUM:-chromium}"
tmp="$(mktemp -d)"
node --import tsx -e "
import { KIND_TILES } from './src/slack/tiles.ts';
for (const [kind, t] of Object.entries(KIND_TILES)) console.log([t.slug, kind, t.bg, t.fg].join('\t'));
" | while IFS=$'\t' read -r slug kind bg fg; do
  size=$([ ${#kind} -ge 3 ] && echo 66 || echo 78)
  cat > "$tmp/$slug.html" <<HTML
<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Do+Hyeon&display=block">
<style>html,body{margin:0;background:transparent}
div{width:240px;height:240px;border-radius:52px;background:$bg;color:$fg;display:flex;align-items:center;justify-content:center;
font-family:'Do Hyeon',sans-serif;font-size:${size}px;letter-spacing:-1px}</style>
<div>$kind</div>
HTML
  "$CHROMIUM" --no-sandbox --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --virtual-time-budget=4000 --window-size=240,240 --screenshot="assets/tiles/$slug.png" "file://$tmp/$slug.html" 2>/dev/null
  echo "assets/tiles/$slug.png"
done
rm -rf "$tmp"
