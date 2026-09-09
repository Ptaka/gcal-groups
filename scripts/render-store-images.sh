#!/usr/bin/env bash
# store/src/*.html を Chrome headless で撮影し、ストア用 PNG を生成する
# 使い方: scripts/render-store-images.sh
set -eu
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p store/screenshots

# 使い方: shoot <src.html> <out.png> <WxH>
shoot() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$3" --screenshot="$PWD/$2" "file://$PWD/$1" 2>/dev/null
  echo "生成: $2"
}

shoot store/src/screenshot-01.html store/screenshots/01-overview.png   1280,800
shoot store/src/screenshot-02.html store/screenshots/02-toggle.png     1280,800
shoot store/src/screenshot-03.html store/screenshots/03-manage.png     1280,800
shoot store/src/screenshot-04.html store/screenshots/04-pin-export.png 1280,800
shoot store/src/promo-small.html   store/promo-small.png               440,280
