#!/usr/bin/env bash
# ストア公開用の成果物(アイコン・画像・manifest・zip 同梱)を検証する
# 使い方: scripts/check-store-assets.sh
set -u
cd "$(dirname "$0")/.."
fail=0

# 画像の寸法と透過の有無を検証する
# 使い方: check_png <path> <width> <height>
check_png() {
  local f="$1" w="$2" h="$3"
  if [ ! -f "$f" ]; then echo "NG $f: ファイルがない"; fail=1; return; fi
  local pw ph alpha
  pw=$(sips -g pixelWidth "$f" | awk '/pixelWidth/{print $2}')
  ph=$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')
  alpha=$(sips -g hasAlpha "$f" | awk '/hasAlpha/{print $2}')
  if [ "$pw" != "$w" ] || [ "$ph" != "$h" ]; then
    echo "NG $f: ${pw}x${ph} (期待 ${w}x${h})"; fail=1; return
  fi
  if [ "$alpha" = "yes" ]; then echo "NG $f: 透過あり"; fail=1; return; fi
  echo "OK $f ${w}x${h}"
}

# ---- manifest ----
if ! jq -e . manifest.json >/dev/null; then echo "NG manifest.json: JSON として不正"; fail=1; fi

# ---- 移行前の組織名の残存チェック(未追跡ファイルも含めて走査。.git と scratch 系は除外) ----
# 検出語は 1 文字ずつ連結して、このスクリプト自身が検出対象にならないようにする
OLD_ORG=$(printf 'x%s' 'tone')
if grep -rIl -i "$OLD_ORG" . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.agents --exclude-dir=delivery -q; then
  echo "NG: 移行前の組織名が含まれるファイルがある"; grep -rIl -i "$OLD_ORG" . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.agents --exclude-dir=delivery; fail=1
fi

# ---- アイコン ----
for s in 16 32 48 128; do check_png "icons/icon-$s.png" "$s" "$s"; done
for s in 16 32 48 128; do
  if [ "$(jq -r ".icons[\"$s\"]" manifest.json)" != "icons/icon-$s.png" ]; then
    echo "NG manifest.json: icons.$s が icons/icon-$s.png でない"; fail=1
  fi
done

# ---- リリース zip の同梱内容(release.yml と同じ手順) ----
ZIPTMP=$(mktemp -d)
mkdir -p "$ZIPTMP/gcal-groups"
cp manifest.json content.js styles.css "$ZIPTMP/gcal-groups/"
mkdir -p "$ZIPTMP/gcal-groups/icons" && cp icons/*.png "$ZIPTMP/gcal-groups/icons/" 2>/dev/null || true
(cd "$ZIPTMP" && zip -qr test.zip gcal-groups)
for f in manifest.json content.js styles.css icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png; do
  if ! unzip -l "$ZIPTMP/test.zip" | grep -q "gcal-groups/$f"; then echo "NG zip: $f が含まれない"; fail=1; fi
done
if unzip -l "$ZIPTMP/test.zip" | grep -q "icon.svg"; then echo "NG zip: icon.svg は同梱しない"; fail=1; fi
if ! grep -q 'cp icons/\*.png dist/gcal-groups/icons/' .github/workflows/release.yml; then
  echo "NG release.yml: icons を同梱していない"; fail=1
fi
rm -rf "$ZIPTMP"
echo "OK zip 同梱内容"

# ---- プライバシーポリシー ----
if [ ! -f PRIVACY.md ]; then echo "NG PRIVACY.md がない"; fail=1; else
  for kw in "chrome.storage.sync" "chrome.storage.local" "外部" "第三者" "Privacy Policy" "github.com/Ptaka/gcal-groups/issues"; do
    grep -q "$kw" PRIVACY.md || { echo "NG PRIVACY.md: 「$kw」の記載がない"; fail=1; }
  done
  echo "OK PRIVACY.md"
fi

# (以降の Task で検証項目を追加する)

if [ "$fail" -ne 0 ]; then echo "検証失敗"; exit 1; fi
echo "検証成功"
