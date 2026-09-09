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

# (以降の Task で検証項目を追加する)

if [ "$fail" -ne 0 ]; then echo "検証失敗"; exit 1; fi
echo "検証成功"
