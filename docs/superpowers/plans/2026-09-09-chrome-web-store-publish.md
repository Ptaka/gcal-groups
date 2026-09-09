# Chrome Web Store 公開 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「Google Calendar グループ切替」を Chrome Web Store に一般公開するために必要な、アイコン・プライバシーポリシー・掲載素材・v3.16.0 リリースを揃える。

**Architecture:** 拡張はビルド不要の素の JS/CSS で、テストフレームワークはない。本計画の「テスト」は、成果物の寸法・同梱内容・JSON 整合性をシェルスクリプトで検証する形を取る。画像は SVG/HTML を原本としてリポジトリに置き、Chrome headless で PNG に変換する。ImageMagick 等は導入しない。

**Tech Stack:** Manifest V3、Chrome headless(`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` 152)、`sips`、`jq`、`zip`、GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-08-chrome-web-store-publish-design.md`

## Global Constraints

- 会話・コメント・ドキュメントは日本語(CLAUDE.md)
- コード変更は feature ブランチ + PR。作業ブランチは `feature/chrome-web-store`(作成済み)
- コミットには `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` と `Claude-Session: https://claude.ai/code/session_0152Z5GxtrA9PJ7K6QsoCAza` を末尾に付ける
- リポジトリ URL は `https://github.com/Ptaka/gcal-groups` のみ使う。移行前のリポジトリの名称・URL・組織名をいかなるファイルにも書かない(検証スクリプトが全ファイルを走査して検出する)
- キャプチャは `docs/images/` のマスク済み画像のみ使う。実データの再撮影はしない
- `docs/images/` のファイル名は変えない(README のリンクを壊さない)
- バージョンは `manifest.json` が正。リリース時に `CHANGELOG.md` を更新し、タグは `v3.16.0`
- Chrome headless の共通オプション: `--headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1`(検証済み。出力 PNG は透過なし)
- ストア画像の寸法: アイコン 128×128、スクリーンショット 1280×800、小プロモタイル 440×280。すべて透過なし PNG

---

## ファイル構成

| パス | 役割 |
|---|---|
| `icons/icon.svg` | アイコンの原本(128 viewBox) |
| `icons/icon-{16,32,48,128}.png` | manifest とストアで使う PNG |
| `scripts/render-icons.sh` | SVG から 4 サイズの PNG を生成 |
| `scripts/render-store-images.sh` | `store/src/*.html` からスクリーンショットとプロモタイルを生成 |
| `scripts/check-store-assets.sh` | 成果物の寸法・manifest・同梱内容を検証(本計画のテスト) |
| `store/src/screenshot-0{1..4}.html`, `store/src/promo-small.html` | 画像の原本 HTML |
| `store/screenshots/0{1..4}-*.png`, `store/promo-small.png` | ストアにアップロードする画像 |
| `store/listing.md` | 掲載文と申請フォームの回答案 |
| `PRIVACY.md` | プライバシーポリシー |
| `manifest.json` | `icons` 追加、`version` 3.16.0 |
| `.github/workflows/release.yml` | zip に `icons/` を同梱 |
| `CHANGELOG.md` | v3.16.0 の項 |
| `README.md` | ストア公開後にインストール手順を追加(Task 8、公開後に実施) |

---

### Task 1: 検証スクリプトの土台

**Files:**
- Create: `scripts/check-store-assets.sh`

**Interfaces:**
- Produces: `scripts/check-store-assets.sh` — 引数なしで実行し、失敗があれば非 0 で終了する。以降の Task はこのスクリプトに検証項目を追加していく

- [ ] **Step 1: スクリプトを作成する**

```bash
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
```

- [ ] **Step 2: 実行権限を付けて実行し、成功することを確認する**

Run: `chmod +x scripts/check-store-assets.sh && scripts/check-store-assets.sh`
Expected: `検証成功`

- [ ] **Step 3: コミット**

```bash
git add scripts/check-store-assets.sh
git commit -m "ストア公開用成果物の検証スクリプトを追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0152Z5GxtrA9PJ7K6QsoCAza"
```

---

### Task 2: 拡張アイコン

**Files:**
- Create: `icons/icon.svg`, `scripts/render-icons.sh`
- Create(生成物): `icons/icon-16.png`, `icons/icon-32.png`, `icons/icon-48.png`, `icons/icon-128.png`
- Modify: `manifest.json`, `scripts/check-store-assets.sh`

**Interfaces:**
- Produces: `icons/icon-128.png`(Task 5 のプロモタイルと Task 7 のストアアイコンで使う)、`manifest.json` の `icons` フィールド

- [ ] **Step 1: 検証項目を追加する(失敗するテスト)**

`scripts/check-store-assets.sh` の `# (以降の Task で検証項目を追加する)` の直前に追加:

```bash
# ---- アイコン ----
for s in 16 32 48 128; do check_png "icons/icon-$s.png" "$s" "$s"; done
for s in 16 32 48 128; do
  if [ "$(jq -r ".icons[\"$s\"]" manifest.json)" != "icons/icon-$s.png" ]; then
    echo "NG manifest.json: icons.$s が icons/icon-$s.png でない"; fail=1
  fi
done
```

- [ ] **Step 2: 実行して失敗することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `NG icons/icon-16.png: ファイルがない` などが出て `検証失敗`

- [ ] **Step 3: SVG を作成する**

`icons/icon.svg`(角丸四角のカレンダーに、グループを表す 3 色のチップ。文字なし):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <!-- カレンダー本体 -->
  <rect x="8" y="16" width="112" height="104" rx="20" fill="#ffffff"/>
  <rect x="8" y="16" width="112" height="104" rx="20" fill="none" stroke="#1a73e8" stroke-width="8"/>
  <!-- ヘッダー帯 -->
  <path d="M8 36 A20 20 0 0 1 28 16 H100 A20 20 0 0 1 120 36 V44 H8 Z" fill="#1a73e8"/>
  <!-- 綴じリング -->
  <rect x="36" y="6" width="12" height="22" rx="6" fill="#0b57d0"/>
  <rect x="80" y="6" width="12" height="22" rx="6" fill="#0b57d0"/>
  <!-- グループチップ 3 本 -->
  <rect x="24" y="56" width="80" height="14" rx="7" fill="#1a73e8"/>
  <rect x="24" y="78" width="56" height="14" rx="7" fill="#34a853"/>
  <rect x="24" y="100" width="68" height="12" rx="6" fill="#fbbc04"/>
</svg>
```

- [ ] **Step 4: レンダリングスクリプトを作成する**

`scripts/render-icons.sh`:

```bash
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
  cat > "$TMP/icon-$s.html" <<EOF
<!doctype html><html><body style="margin:0;background:#ffffff">
<img src="file://$PWD/icons/icon.svg" width="$s" height="$s" style="display:block">
</body></html>
EOF
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$s,$s" --screenshot="$PWD/icons/icon-$s.png" "file://$TMP/icon-$s.html" 2>/dev/null
  echo "生成: icons/icon-$s.png"
done
```

- [ ] **Step 5: 生成して目視確認する**

Run: `chmod +x scripts/render-icons.sh && scripts/render-icons.sh && open icons/icon-128.png icons/icon-16.png`
Expected: 4 ファイルが生成され、128px では青枠のカレンダーに 3 色のチップ、16px でも青い四角として判別できる。ぼやけや欠けがあれば SVG の座標を調整して再生成する

- [ ] **Step 6: manifest に icons を追加する**

`manifest.json` の `"description"` 行の直後に追加:

```json
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
```

- [ ] **Step 7: 検証を実行して成功することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `OK icons/icon-16.png 16x16` 〜 `OK icons/icon-128.png 128x128` と `検証成功`

- [ ] **Step 8: Chrome で拡張を読み込み直してアイコンを確認する(手動)**

`chrome://extensions` でこのフォルダの拡張を ↻ し、一覧カードにアイコンが表示されることを確認する。エラーが出る場合は manifest の JSON を見直す

- [ ] **Step 9: コミット**

```bash
git add icons/ scripts/render-icons.sh scripts/check-store-assets.sh manifest.json
git commit -m "拡張アイコンを追加(SVG 原本と 16/32/48/128px PNG)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0152Z5GxtrA9PJ7K6QsoCAza"
```

---

### Task 3: リリース zip に icons を同梱

**Files:**
- Modify: `.github/workflows/release.yml:26-31`
- Modify: `scripts/check-store-assets.sh`

**Interfaces:**
- Consumes: `icons/icon-*.png`(Task 2)
- Produces: Release zip の中に `gcal-groups/icons/icon-{16,32,48,128}.png` が含まれる

- [ ] **Step 1: 検証項目を追加する(失敗するテスト)**

`scripts/check-store-assets.sh` の `# (以降の Task で検証項目を追加する)` の直前に追加。ワークフローと同じ手順で zip を作り、中身を確認する:

```bash
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
```

- [ ] **Step 2: 実行して失敗することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `NG release.yml: icons を同梱していない` と `検証失敗`

- [ ] **Step 3: ワークフローを修正する**

`.github/workflows/release.yml` の `cp manifest.json content.js styles.css dist/gcal-groups/` の直後に 1 行追加:

```yaml
          mkdir -p dist/gcal-groups/icons && cp icons/*.png dist/gcal-groups/icons/
```

(SVG 原本は配布物に不要なので PNG だけを同梱する)

- [ ] **Step 4: 検証を実行して成功することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `OK zip 同梱内容` と `検証成功`

- [ ] **Step 5: コミット**

```bash
git add .github/workflows/release.yml scripts/check-store-assets.sh
git commit -m "リリースzipにアイコンを同梱

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0152Z5GxtrA9PJ7K6QsoCAza"
```

---

### Task 4: プライバシーポリシー

**Files:**
- Create: `PRIVACY.md`
- Modify: `scripts/check-store-assets.sh`

**Interfaces:**
- Produces: `https://github.com/Ptaka/gcal-groups/blob/main/PRIVACY.md`(Task 6 の listing.md で申請 URL として使う)

- [ ] **Step 1: 検証項目を追加する(失敗するテスト)**

`scripts/check-store-assets.sh` の `# (以降の Task で検証項目を追加する)` の直前に追加:

```bash
# ---- プライバシーポリシー ----
if [ ! -f PRIVACY.md ]; then echo "NG PRIVACY.md がない"; fail=1; else
  for kw in "chrome.storage.sync" "chrome.storage.local" "外部" "第三者" "Privacy Policy" "github.com/Ptaka/gcal-groups/issues"; do
    grep -q "$kw" PRIVACY.md || { echo "NG PRIVACY.md: 「$kw」の記載がない"; fail=1; }
  done
  echo "OK PRIVACY.md"
fi
```

- [ ] **Step 2: 実行して失敗することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `NG PRIVACY.md がない` と `検証失敗`

- [ ] **Step 3: PRIVACY.md を作成する**

```markdown
# プライバシーポリシー — Google Calendar グループ切替

最終改定日: 2026-09-09

本拡張機能「Google Calendar グループ切替」(以下「本拡張」)は、Google カレンダーのサイドバーに表示されるカレンダーをグループにまとめ、グループ単位で表示の ON/OFF を切り替えるための Chrome 拡張機能です。本拡張が扱うデータについて、以下のとおり定めます。

## 収集・保存するデータ

本拡張は、機能の提供に必要な次の設定情報のみを、お使いの Chrome の拡張機能用ストレージ(`chrome.storage`)に保存します。

| データ | 保存先 | 用途 |
|---|---|---|
| グループ名と、各グループに含まれるカレンダーの表示名 | `chrome.storage.sync` | グループの定義 |
| ピン留めしたカレンダーの表示名 | `chrome.storage.sync` | 常に表示するカレンダーの記憶 |
| サイドバーから検出したカレンダーの表示名の一覧と検出日時 | `chrome.storage.local` | メンバー編集時の候補表示 |
| チップバーの表示位置、表示モード(重ねて表示/1グループずつ)、現在 ON のグループ | `chrome.storage.local` | 前回の状態の復元 |
| 初回案内(コーチマーク・Tips)を表示済みかどうかのフラグ | `chrome.storage.local` | 案内を繰り返し表示しないため |

`chrome.storage.sync` に保存したデータは、Chrome の同期機能を有効にしている場合、Google のサーバーを経由して同じ Google アカウントでログインした他の Chrome にも同期されます。この同期は Chrome の標準機能であり、本拡張の開発者がアクセスすることはありません。

## 読み取らないデータ

本拡張は、予定のタイトル・内容・日時・参加者・メールアドレス・Google アカウント情報を読み取りません。読み取るのは、サイドバーのカレンダー一覧に表示されているカレンダーの表示名と、そのチェック状態のみです。

## 外部送信・第三者提供

本拡張は、収集したデータを開発者のサーバーや第三者に送信しません。アクセス解析、広告、トラッキングは一切行いません。本拡張は `calendar.google.com` 以外のサイトでは動作せず、外部との通信も行いません。

## エクスポート機能

管理パネルの「エクスポート」は、利用者ご自身の操作によってのみ、グループ設定を JSON ファイルとして生成します。ファイルの保存先は利用者が選択し、本拡張はそのファイルを保持・送信しません。エクスポートしたファイルにはカレンダーの表示名が含まれるため、共有先にはご注意ください。

## データの削除

本拡張をアンインストールすると、`chrome.storage.local` および `chrome.storage.sync` に保存したデータは Chrome によって削除されます。個別のグループは管理パネルからいつでも削除できます。

## 権限の利用目的

| 権限 | 目的 |
|---|---|
| `storage` | 上記の設定情報を保存するため |
| `https://calendar.google.com/*` でのコンテンツスクリプト実行 | Google カレンダーのサイドバーを読み取り、チップバーを表示し、カレンダーの表示 ON/OFF を切り替えるため |

## 改定

本ポリシーを変更する場合は、本ページを更新し、最終改定日を改めます。

## お問い合わせ

https://github.com/Ptaka/gcal-groups/issues

---

## Privacy Policy (English summary)

"Google Calendar グループ切替" (Google Calendar Group Switcher) stores only its own settings — group names, calendar display names in each group, pinned calendar names, bar position, display mode, active groups, detected calendar names, and onboarding flags — in `chrome.storage.sync` and `chrome.storage.local`. Data in `chrome.storage.sync` may be synced across your Chrome browsers by Google's standard Chrome Sync; the developer never has access to it.

The extension does not read event titles, details, attendees, or account information. It does not transmit any data to the developer or third parties, and contains no analytics, advertising, or tracking. It runs only on `calendar.google.com` and makes no network requests. The export feature creates a JSON file only when you choose to, saved where you choose. Uninstalling the extension removes all stored data.

Contact: https://github.com/Ptaka/gcal-groups/issues
```

- [ ] **Step 4: 検証を実行して成功することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `OK PRIVACY.md` と `検証成功`

- [ ] **Step 5: 記載内容がコードと一致することを確認する**

Run: `grep -o -E '"gcg[A-Za-z]+"' content.js | sort -u`
Expected: gcgActiveGroups, gcgBarPos, gcgDragTipShown, gcgEditorTipShown, gcgExclusive, gcgGroups, gcgKnownCalendars, gcgOnboarded, gcgPinned, gcgPinTipShown, gcgScanMeta, gcgScanNames の 12 個。すべて PRIVACY.md の表のいずれかの行に該当する(sync は gcgGroups と gcgPinned のみ。`grep -n "storage.sync" content.js` で確認)

- [ ] **Step 6: コミット**

```bash
git add PRIVACY.md scripts/check-store-assets.sh
git commit -m "プライバシーポリシーを追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0152Z5GxtrA9PJ7K6QsoCAza"
```

---

### Task 5: ストア用スクリーンショットとプロモタイル

**Files:**
- Create: `store/src/base.css`, `store/src/screenshot-01.html`, `store/src/screenshot-02.html`, `store/src/screenshot-03.html`, `store/src/screenshot-04.html`, `store/src/promo-small.html`, `scripts/render-store-images.sh`
- Create(生成物): `store/screenshots/01-overview.png`, `store/screenshots/02-toggle.png`, `store/screenshots/03-manage.png`, `store/screenshots/04-pin-export.png`, `store/promo-small.png`
- Modify: `scripts/check-store-assets.sh`

**Interfaces:**
- Consumes: `docs/images/{hero,chip-bar,panel,member-editor}.png`, `docs/images/demo.gif`, `icons/icon-128.png`(Task 2)
- Produces: 上記 5 枚の PNG(Task 7 でアップロード)

- [ ] **Step 1: 検証項目を追加する(失敗するテスト)**

`scripts/check-store-assets.sh` の `# (以降の Task で検証項目を追加する)` の直前に追加:

```bash
# ---- ストア画像 ----
for f in 01-overview 02-toggle 03-manage 04-pin-export; do check_png "store/screenshots/$f.png" 1280 800; done
check_png store/promo-small.png 440 280
```

- [ ] **Step 2: 実行して失敗することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `NG store/screenshots/01-overview.png: ファイルがない` などと `検証失敗`

- [ ] **Step 3: 共通 CSS を作成する**

`store/src/base.css`:

```css
/* ストア用画像の共通スタイル。ページ全体を 1280x800 または 440x280 に固定する */
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  width: 1280px; height: 800px; overflow: hidden;
  font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  background: linear-gradient(135deg, #e8f0fe 0%, #ffffff 60%);
  color: #202124;
  display: flex; flex-direction: column; padding: 56px 72px;
}
h1 { font-size: 44px; font-weight: 700; margin: 0 0 12px; line-height: 1.3; }
p.lead { font-size: 22px; color: #5f6368; margin: 0 0 32px; line-height: 1.6; }
.stage { flex: 1; display: flex; align-items: center; justify-content: center; gap: 48px; min-height: 0; }
.shot { max-width: 100%; max-height: 100%; border-radius: 12px; box-shadow: 0 12px 40px rgba(60,64,67,.25); background: #fff; }
.col { display: flex; flex-direction: column; gap: 24px; }
ul.points { font-size: 22px; line-height: 1.7; margin: 0; padding-left: 1.2em; color: #3c4043; }
```

- [ ] **Step 4: スクリーンショット HTML を 4 枚作成する**

`store/src/screenshot-01.html`(全体像):

```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="base.css"></head>
<body>
  <h1>カレンダーをグループにまとめて、ワンクリックで切り替え</h1>
  <p class="lead">「チーム」「案件」「会議室」など、見たい組み合わせを画面上部のチップで一発表示。</p>
  <div class="stage"><img class="shot" src="../../docs/images/hero.png" alt=""></div>
</body></html>
```

`store/src/screenshot-02.html`(まとめて ON/OFF):

```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="base.css"></head>
<body>
  <h1>チップをクリックするだけで、まとめて表示 ON/OFF</h1>
  <p class="lead">サイドバーのチェックボックスを 1 つずつ触る必要はもうありません。</p>
  <div class="stage">
    <div class="col" style="flex:1">
      <img class="shot" src="../../docs/images/chip-bar.png" alt="" style="width:100%;max-width:640px;image-rendering:auto">
      <ul class="points">
        <li>青塗り: グループの全カレンダーを表示中</li>
        <li>淡い青: 一部のカレンダーだけ表示中</li>
        <li>白: すべて非表示 / グレー: 対象なし</li>
      </ul>
    </div>
    <img class="shot" src="../../docs/images/demo.gif" alt="" style="flex:1.2;max-width:620px">
  </div>
</body></html>
```

`store/src/screenshot-03.html`(グループを作る):

```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="base.css"></head>
<body>
  <h1>グループ作りは、名前を入れてチェックするだけ</h1>
  <p class="lead">⚙ の管理パネルからグループを追加し、入れたいカレンダーにチェック。名前で絞り込みもできます。</p>
  <div class="stage">
    <img class="shot" src="../../docs/images/panel.png" alt="" style="height:100%;max-height:520px">
    <img class="shot" src="../../docs/images/member-editor.png" alt="" style="height:100%;max-height:520px">
  </div>
</body></html>
```

`store/src/screenshot-04.html`(ピン留めと共有):

```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="base.css"></head>
<body>
  <h1>ピン留め・重ねて表示・チームで共有</h1>
  <p class="lead">毎日の使い方に合わせて、細かく調整できます。</p>
  <div class="stage">
    <ul class="points" style="font-size:26px;line-height:1.9;max-width:1000px">
      <li>📌 <b>ピン留め</b>: 自分のカレンダーなど、いつも見たいものはグループを OFF にしても表示したまま</li>
      <li>🔀 <b>重ねて表示 / 1 グループずつ</b>: 空き時間探しは重ねて、集中したいときは 1 グループに</li>
      <li>⋮⋮ <b>バーの位置は自由</b>: ドラッグで好きな場所へ。位置は記憶されます</li>
      <li>📤 <b>エクスポート / インポート</b>: グループ設定を JSON で書き出し、チームに配布・バックアップ</li>
      <li>🔒 <b>データは端末内だけ</b>: 予定の内容は読み取らず、外部送信もしません</li>
    </ul>
  </div>
</body></html>
```

- [ ] **Step 5: プロモタイル HTML を作成する**

`store/src/promo-small.html`(440×280。body サイズを上書きする):

```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="base.css">
<style>
  body { width: 440px; height: 280px; padding: 32px 36px; flex-direction: row; align-items: center; gap: 28px;
         background: linear-gradient(135deg, #1a73e8 0%, #0b57d0 100%); color: #fff; }
  img { width: 112px; height: 112px; border-radius: 24px; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
  h1 { font-size: 30px; margin: 0 0 8px; }
  p { font-size: 16px; margin: 0; line-height: 1.5; opacity: .92; }
</style></head>
<body>
  <img src="../../icons/icon-128.png" alt="">
  <div><h1>Google Calendar<br>グループ切替</h1><p>カレンダーをグループにまとめて<br>ワンクリックで表示切替</p></div>
</body></html>
```

- [ ] **Step 6: レンダリングスクリプトを作成する**

`scripts/render-store-images.sh`:

```bash
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
```

- [ ] **Step 7: 生成して目視確認する**

Run: `chmod +x scripts/render-store-images.sh && scripts/render-store-images.sh && open store/screenshots/*.png store/promo-small.png`
Expected: 5 枚が生成される。文字が枠内に収まり、画像が切れていない。フォントが豆腐(□)になっていない。はみ出しがあれば該当 HTML の `max-height` やフォントサイズを調整して再生成する

- [ ] **Step 8: 検証を実行して成功することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `OK store/screenshots/01-overview.png 1280x800` 〜 `OK store/promo-small.png 440x280` と `検証成功`

- [ ] **Step 9: コミット**

```bash
git add store/ scripts/render-store-images.sh scripts/check-store-assets.sh
git commit -m "ストア掲載用のスクリーンショットとプロモタイルを追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0152Z5GxtrA9PJ7K6QsoCAza"
```

---

### Task 6: 掲載文と申請フォームの回答案

**Files:**
- Create: `store/listing.md`
- Modify: `scripts/check-store-assets.sh`

**Interfaces:**
- Consumes: `PRIVACY.md` の URL(Task 4)
- Produces: Task 7 でフォームに転記する原稿

- [ ] **Step 1: 検証項目を追加する(失敗するテスト)**

`scripts/check-store-assets.sh` の `# (以降の Task で検証項目を追加する)` の直前に追加。概要が 132 字以内であることを検証する:

```bash
# ---- 掲載文 ----
if [ ! -f store/listing.md ]; then echo "NG store/listing.md がない"; fail=1; else
  summary=$(awk '/^<!-- summary-start -->/{f=1;next} /^<!-- summary-end -->/{f=0} f' store/listing.md | tr -d '\n')
  # wc -m はロケール依存で日本語をバイト数で数えることがあるため python3 で文字数を数える
  len=$(printf '%s' "$summary" | python3 -c 'import sys; print(len(sys.stdin.read()))')
  if [ "$len" -gt 132 ] || [ "$len" -eq 0 ]; then echo "NG listing.md: 概要が ${len} 字(1〜132 字)"; fail=1; else echo "OK listing.md 概要 ${len} 字"; fi
fi
```

- [ ] **Step 2: 実行して失敗することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `NG store/listing.md がない` と `検証失敗`

- [ ] **Step 3: listing.md を作成する**

```markdown
# Chrome Web Store 掲載情報

Developer Dashboard の各欄に転記する原稿。`<!-- summary-start -->` 〜 `<!-- summary-end -->` は検証スクリプトが字数を数える。

## ストアの掲載情報

**名前**: Google Calendar グループ切替

**概要(132 字以内)**:
<!-- summary-start -->
Googleカレンダーのサイドバーのカレンダーを「チーム」「案件」などのグループにまとめ、画面上部のチップをクリックするだけでグループ単位の表示ON/OFFを切り替えられます。
<!-- summary-end -->

**詳細説明**:

Googleカレンダーで複数のカレンダーを重ねて見ている方向けの拡張です。サイドバーのチェックボックスを1つずつ切り替える代わりに、画面上部に並ぶチップを1回クリックするだけで、グループ単位でまとめて表示のON/OFFができます。

■ こんなときに
・朝いちばんに「自分の予定だけ」の状態へ戻したい
・会議調整のときだけ、チームメンバー全員のカレンダーを重ねたい
・会議室や共有カレンダーは、必要なときだけ表示したい

■ 主な機能
・グループの作成: ⚙ の管理パネルからグループ名を入れて、入れたいカレンダーにチェックするだけ
・チップで切り替え: 青塗り=全表示、淡い青=一部表示、白=非表示、グレー=対象なし、と状態が一目でわかる
・重ねて表示 / 1グループずつ: 複数グループを重ねる表示と、クリックしたグループだけに絞る表示を切り替え
・ピン留め: 自分のカレンダーなど、グループをOFFにしても常に表示したいカレンダーを指定
・バーの位置を自由に移動: ドラッグで好きな場所へ。位置は記憶されます
・エクスポート / インポート: グループ設定をJSONで書き出してチームで共有・バックアップ
・自動検出: サイドバーを自動スクロールして、画面外のカレンダーも検出

■ プライバシー
・保存するのはグループ設定とカレンダーの表示名だけです(chrome.storage)
・予定の内容・参加者・アカウント情報は読み取りません
・外部サーバーへの送信、アクセス解析、広告は一切ありません
・calendar.google.com 以外では動作しません

■ 仕組みと注意
・カレンダーは「表示名」で識別します。名前を変えたらグループに入れ直してください
・表示の切り替えはサイドバーのチェックボックスを操作する方式のため、サイドバーが非表示のときは動作しません
・Googleカレンダー本体のDOMには要素を挿入せず、独立したオーバーレイとして動作します

ソースコード・不具合報告: https://github.com/Ptaka/gcal-groups

**カテゴリ**: 仕事効率化(Productivity)
**言語**: 日本語
**ストアアイコン**: `icons/icon-128.png`
**スクリーンショット**: `store/screenshots/01-overview.png` 〜 `04-pin-export.png`(1280×800)
**小プロモタイル**: `store/promo-small.png`(440×280)
**公式 URL / ホームページ**: https://github.com/Ptaka/gcal-groups
**サポート URL**: https://github.com/Ptaka/gcal-groups/issues

## プライバシー タブ

**単一目的の説明**:
Googleカレンダーのサイドバーに表示されるカレンダーをグループにまとめ、グループ単位で表示のON/OFFを切り替える。

**権限の理由**:
- `storage`: 作成したグループ、ピン留め、チップバーの位置などの設定を保存するため。
- ホスト権限 `https://calendar.google.com/*`: Googleカレンダーのサイドバーからカレンダーの表示名とチェック状態を読み取り、チップバーを表示し、チェックボックスを操作して表示を切り替えるため。他のサイトでは動作しない。

**リモートコードを使用していますか**: いいえ

**データ使用**(該当するものにチェック):
- [x] ウェブサイトのコンテンツ(Website content)— サイドバーに表示されるカレンダーの表示名を、グループ設定として端末内の chrome.storage に保存する
- [ ] 個人を特定できる情報 / 健康情報 / 財務情報 / 認証情報 / 個人的な通信 / 位置情報 / ウェブの履歴 / ユーザーのアクティビティ: いずれも該当なし

**証明**(3 つすべてにチェック):
- [x] 承認されたユースケース以外の目的でユーザーデータを販売または譲渡しない
- [x] アイテムの単一目的に関係のない目的でユーザーデータを使用または譲渡しない
- [x] 信用度の判断や融資目的でユーザーデータを使用または譲渡しない

**プライバシーポリシー URL**: https://github.com/Ptaka/gcal-groups/blob/main/PRIVACY.md

## 配布 タブ

- **公開設定**: 公開(Public)
- **配布地域**: すべての地域
- **有料/無料**: 無料

## テスト手順 タブ

不要(ログイン不要。calendar.google.com を開くと画面上部中央にチップバーが表示される)

## アップロードする zip

GitHub Release `v3.16.0` の `gcal-groups-v3.16.0.zip` をそのままアップロードする(manifest.json / content.js / styles.css / icons/ を含む)。
```

- [ ] **Step 4: 検証を実行して成功することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `OK listing.md 概要 NN 字`(NN は 132 以下)と `検証成功`

- [ ] **Step 5: コミット**

```bash
git add store/listing.md scripts/check-store-assets.sh
git commit -m "ストア掲載文と申請フォームの回答案を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0152Z5GxtrA9PJ7K6QsoCAza"
```

---

### Task 7: v3.16.0 リリースと PR

**Files:**
- Modify: `manifest.json`(version)、`CHANGELOG.md`、`README.md`(開発節)
- Modify: `scripts/check-store-assets.sh`

**Interfaces:**
- Consumes: Task 1〜6 のすべて
- Produces: PR、マージ後のタグ `v3.16.0` と Release zip

- [ ] **Step 1: 検証項目を追加する(失敗するテスト)**

`scripts/check-store-assets.sh` の `# (以降の Task で検証項目を追加する)` の直前に追加。manifest のバージョンが CHANGELOG の先頭項目と一致することを検証する:

```bash
# ---- バージョン整合 ----
mv=$(jq -r .version manifest.json)
cv=$(grep -m1 -o -E '^## v[0-9]+\.[0-9]+\.[0-9]+' CHANGELOG.md | sed 's/^## v//')
if [ "$mv" != "$cv" ]; then echo "NG バージョン不一致: manifest=$mv CHANGELOG=$cv"; fail=1; else echo "OK version $mv"; fi
```

- [ ] **Step 2: CHANGELOG だけ先に更新し、検証が失敗することを確認する**

Step 4 の内容を先に CHANGELOG.md へ追加してから実行する:

Run: `scripts/check-store-assets.sh`
Expected: `NG バージョン不一致: manifest=3.15.0 CHANGELOG=3.16.0` と `検証失敗`

- [ ] **Step 3: manifest のバージョンを上げる**

`manifest.json` の `"version": "3.15.0"` を `"version": "3.16.0"` に変更する

- [ ] **Step 4: CHANGELOG に項を追加する(Step 2 で済んでいれば内容を確認するだけ)**

`CHANGELOG.md` の `# Changelog` の直後(空行を挟んで `## v3.15.0` の前)に追加:

```markdown
## v3.16.0
- Chrome Web Store 公開に向けた準備
  - 拡張アイコンを追加(16/32/48/128px)。リリースzipにも同梱
  - プライバシーポリシー(PRIVACY.md)を追加
  - ストア掲載用のスクリーンショット・プロモタイル・掲載文を `store/` に追加
```

- [ ] **Step 5: README の開発節に生成スクリプトの案内を追加する**

`README.md` の `## 開発` 節の末尾(`docs/images/` の行の直後)に追加:

```markdown
- アイコンは `icons/icon.svg` が原本です。変更したら `scripts/render-icons.sh` で PNG を再生成してください。
- Chrome Web Store 用の画像と掲載文は `store/` にあります。画像は `scripts/render-store-images.sh` で生成し、`scripts/check-store-assets.sh` で寸法などを検証できます。
```

- [ ] **Step 6: 検証を実行して成功することを確認する**

Run: `scripts/check-store-assets.sh`
Expected: `OK version 3.16.0` と `検証成功`

- [ ] **Step 7: Chrome で拡張を読み込み直して動作確認する(手動)**

`chrome://extensions` で ↻ し、バージョン表示が 3.16.0、アイコンが表示される。calendar.google.com を開き、チップバーが従来どおり表示・動作する

- [ ] **Step 8: コミットして push し、PR を作る**

```bash
git add manifest.json CHANGELOG.md README.md scripts/check-store-assets.sh
git commit -m "v3.16.0: Chrome Web Store 公開準備

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0152Z5GxtrA9PJ7K6QsoCAza"
git push -u origin feature/chrome-web-store
gh pr create --title "v3.16.0: Chrome Web Store 公開準備" --body "$(cat <<'EOF'
## 概要
Chrome Web Store への一般公開に必要な成果物を追加します。

- 拡張アイコン(`icons/`、SVG 原本と 16/32/48/128px PNG)と manifest の `icons` 設定
- リリース zip に `icons/` を同梱
- プライバシーポリシー `PRIVACY.md`
- ストア掲載用のスクリーンショット 4 枚・小プロモタイル・掲載文(`store/`)
- 生成スクリプト `scripts/render-icons.sh`、`scripts/render-store-images.sh` と検証スクリプト `scripts/check-store-assets.sh`
- v3.16.0 へのバージョン更新と CHANGELOG

設計: `docs/superpowers/specs/2026-09-08-chrome-web-store-publish-design.md`

## 確認
- [x] `scripts/check-store-assets.sh` が成功
- [x] `chrome://extensions` で読み込み直し、アイコンと動作を確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_0152Z5GxtrA9PJ7K6QsoCAza
EOF
)"
```

- [ ] **Step 9: PR をマージし、タグを push する(ユーザー確認後)**

PR をユーザーがレビュー・マージした後:

```bash
git checkout main && git pull
git tag v3.16.0 && git push origin v3.16.0
# ワークフロー完了までポーリング(gh run watch は対話的になるため使わない)
for i in $(seq 1 12); do
  st=$(gh run list -R Ptaka/gcal-groups --limit 1 --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"')
  echo "$st"; case "$st" in completed*) break;; esac; sleep 10
done
gh release view v3.16.0 -R Ptaka/gcal-groups --json assets --jq '.assets[].name'
# プライバシーポリシーが未認証で読めること(申請 URL の妥当性)
curl -s -o /dev/null -w 'PRIVACY.md HTTP %{http_code}\n' https://raw.githubusercontent.com/Ptaka/gcal-groups/main/PRIVACY.md
```

Expected: `completed success`、`gcal-groups-v3.16.0.zip`、`PRIVACY.md HTTP 200`。ストアへの申請(Step 11)はこの確認が通るまで行わない

- [ ] **Step 10: zip の同梱内容を確認する**

```bash
gh release download v3.16.0 -R Ptaka/gcal-groups -p '*.zip' -D /tmp/gcg-release --clobber
unzip -l /tmp/gcg-release/gcal-groups-v3.16.0.zip
```

Expected: `gcal-groups/icons/icon-16.png` 〜 `icon-128.png` を含む 7 ファイル

- [ ] **Step 11: ストアに申請する(ユーザーが実施)**

Developer Dashboard(https://chrome.google.com/webstore/devconsole)で「新しいアイテム」から上記 zip をアップロードし、`store/listing.md` の内容を各タブに転記して「審査のため送信」する。審査期間は通常数日。

---

### Task 8: 公開後の README 更新(ストア URL 確定後に実施)

**Files:**
- Modify: `README.md:17-40`

**Interfaces:**
- Consumes: ストアの公開 URL(`https://chromewebstore.google.com/detail/<id>` の形式)

- [ ] **Step 1: インストール節の先頭にストアからの手順を追加する**

`README.md` の `## インストール` の直後、`### 利用者向け(おすすめ): リリースzipから` の前に追加(`<STORE_URL>` は実際の URL に置き換える):

```markdown
### Chrome Web Store から(おすすめ)

[Chrome Web Store のページ](<STORE_URL>) で「Chrome に追加」をクリックします。更新は自動で行われます。
```

同時に既存の見出し `### 利用者向け(おすすめ): リリースzipから` を `### リリースzipから(ストアを使わない場合)` に変更する。

- [ ] **Step 2: 表示を確認してコミット・push する**

ドキュメントのみの変更なので main へ直 push してよい:

```bash
grep -n "chromewebstore.google.com" README.md
git add README.md
git commit -m "README: Chrome Web Store からのインストール手順を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0152Z5GxtrA9PJ7K6QsoCAza"
git push origin main
```

Expected: `grep` がストア URL の行を 1 件表示する
