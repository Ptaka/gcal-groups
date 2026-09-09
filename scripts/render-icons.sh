#!/usr/bin/env bash
# icons/icon.svg から 16/32/48/128px の PNG を生成する(Chrome headless を使用)
# 使い方: scripts/render-icons.sh
set -eu
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for s in 16 32 48 128; do
  # SVG を目的サイズで貼り込んだ HTML を作り、ウィンドウごと撮影する
  cat > "$TMP/icon-$s.html" <<HTML
<!doctype html><html><body style="margin:0;background:#ffffff">
<img src="file://$PWD/icons/icon.svg" width="$s" height="$s" style="display:block">
</body></html>
HTML
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$s,$s" --screenshot="$PWD/icons/icon-$s.png" "file://$TMP/icon-$s.html" 2>/dev/null
  echo "生成: icons/icon-$s.png"
done
