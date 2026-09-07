---
name: update-readme-captures
description: READMEの画面キャプチャ(docs/images/)をマスキング付きで撮り直す。チップバー・管理パネルなどUIに見える変更を入れた後、READMEの説明文とキャプチャ・デモGIFを併せて更新するときに使う。引数 demo-only で、リポジトリに反映せず動作デモの撮影・確認だけを行う。
---

# READMEキャプチャの更新手順

READMEに掲載するキャプチャを、実際に拡張が動作しているGoogleカレンダー上で、**個人情報をマスクした状態で**撮り直す手順。

## モード(引数)

| 引数 | 実行する手順 | 用途 |
|---|---|---|
| なし(既定) | 1 → 2 → 3 → 4 の全工程 | READMEのキャプチャを新UIに差し替える |
| `demo-only` | 1 → 2 → 4の「状態復元」「マスク解除」「作業用ファイル削除」のみ | 動作デモを見たい・撮影して確認したいだけ |

`demo-only` では **手順3(docs/images/ への配置)とREADME更新を行わない**。撮影したGIFは確認用に見せた後、作業用ファイルとして削除する。リポジトリの成果物には一切触れないこと。

## 大原則

1. **マスクなしのキャプチャを絶対に成果物にしない。** 予定・実名・会社ロゴ・アバターが写ったファイルを docs/ に置かない
2. **実名の対応表をリポジトリに書かない。** マスクは `mask.js` の自動マッピング方式を使う(検出した名前にダミー名プールから機械的に割り当てる)
3. **ユーザーの画面を妨げない。** 作業はすべてClaude in ChromeのMCPタブ(バックグラウンド)内で行う。ウィンドウの前面化・リサイズ・macOSの `screencapture` は使わない(会議中・画面共有中の可能性がある)
4. **表示状態は必ず復元する。** 撮影のためにカレンダーの表示ON/OFFを変えるので、開始前に状態を記録し、終了時に完全に戻す

## 前提

- Claude in Chrome(mcp__claude-in-chrome__*)が接続され、拡張がインストール済みのChromeで `calendar.google.com` にログインしていること
- `ffmpeg` が使えること

## 手順

### 1. 準備

1. MCPタブで `calendar.google.com` を開き、チップバー(`.gcg-chips`)の表示を確認
2. **状態を記録**:
   ```js
   window.__origState=[...document.querySelectorAll('input[type="checkbox"][aria-label]')]
     .map(b=>({label:b.getAttribute('aria-label'),checked:b.checked}));
   ```
   注意: ページをリロードすると消えるため、リロードしたら取り直す
3. 一度⚙パネルを開いて閉じる(拡張のキャッシュ済み候補名をDOMに出して、マスク対象の収集漏れを防ぐ)
4. このディレクトリの `mask.js` を Read して、javascript_tool でページに注入
5. スクリーンショットを撮り、**目視で確認**: 予定がぼけているか、サイドバー・チップ・パネルに実名が残っていないか、右上のアバター/組織ロゴがぼけているか。漏れがあれば `window.__mask.add('実名','ダミー名')` で追加、ぼかしセレクタ(`gb_*` は変わりうる)は `__mask_style` を調整

### 2. 撮影(gif_creator方式)

`computer` の screenshot は `save_to_disk` してもローカルにファイルが残らない。**gif_creator でGIF化 → ffmpegでフレーム抽出**が唯一の確実な方法。

**フレームは `computer` のアクション(click/scroll/hover)時にのみ記録される。** screenshotだけではフレームにならない。

**静止画(クリック印を入れない)**:
1. `start_recording`
2. 状態を**JSクリックで**作る(JSクリックは記録されず、クリック印も付かない)
3. `hover` を2回(座標を1pxずらす) → フレーム化される
4. `stop_recording` → `export`(download:true、オーバーレイ全部false、quality:3)
5. `~/Downloads` に落ちたGIFから `ffmpeg -i in.gif -frames:v 1 -update 1 out.png`

**デモGIF(クリック印あり)**:
1. `start_recording` → screenshot(初期状態)
2. `computer` の left_click でチップ操作 → wait 2.5秒(切替の自動スクロール待ち) → screenshot、を状態ごとに繰り返す
3. `stop_recording` → `export`(download:true、showClickIndicators:true、watermark/labels/progressBar:false、quality:5)

### 3. 最適化と配置

> `demo-only` のときはこの手順をスキップし、手順4へ進む。

ファイル名は**据え置き**(READMEのリンクを壊さない): `demo.gif` `hero.png` `chip-bar.png` `panel.png` `member-editor.png`

```bash
# デモGIF圧縮(目安: 2MB未満)
ffmpeg -i in.gif -vf "fps=10,scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" docs/images/demo.gif
# クローズアップ切り出し(座標は都度スクリーンショットで確認)
ffmpeg -i hero.png -vf "crop=W:H:X:Y" docs/images/chip-bar.png
```

### 4. 後片付けと検証

1. **状態復元**: グループチップをOFFに戻したうえで、`__origState` と全チェックボックスを突合し、差分があれば個別クリックで修正。最後に全件一致を確認
2. マスク解除: `window.__mask.stop()` してページをリロード
3. `~/Downloads` に落とした作業用GIFを削除
4. **マスク漏れの最終チェック**: `ffmpeg -i <GIF> frames/f%02d.png` で全フレームを展開し、代表フレームを目視確認。`demo-only` でも、撮影物をユーザーに見せる前に必ず実施する
5. README本文の説明がUIの現状と合っているか確認して更新(UXライティング: 目的ベースの見出し・1ステップ1アクション・状態と結果を明示)

> `demo-only` のときは 1〜4 のみ実施し、5(README更新)は行わない。撮影したGIFは確認後に削除する。

## トラブルシューティング

- チェックボックスが0件 → サイドバーのレンダリングが遅延している。数秒待って再取得
- `stop_recording` が「0 frames」 → アクションを挟んでいない。hover2回を入れる
- javascript_tool が `[BLOCKED: Cookie/query string data]` → innerHTML等を返そうとしている。タグ名・テキストだけ返す
