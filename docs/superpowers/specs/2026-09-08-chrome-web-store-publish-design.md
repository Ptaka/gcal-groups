# Chrome Web Store 公開 設計書

作成日: 2026-09-08

## 目的

「Google Calendar グループ切替」を Chrome Web Store に一般公開(Public)し、利用者がデベロッパーモードなしでインストール・自動更新できるようにする。

## 前提

- デベロッパー登録は Ptaka の Google アカウントで済んでいる
- リポジトリ https://github.com/Ptaka/gcal-groups は public。プライバシーポリシーはここに置く
- 拡張の権限は `storage` と `https://calendar.google.com/*` の content script のみ。外部通信はない
- 初回のストアアップロードは手動で行う。自動化は公開後に別途検討する

## 成果物

### 1. 拡張本体(v3.16.0)

| 項目 | 内容 |
|---|---|
| `icons/icon-16.png` ほか 32/48/128 | 新規作成。`icons/icon.svg` を原本とし、Chrome headless で PNG 化する |
| `manifest.json` | `icons` フィールドを追加、`version` を 3.16.0 に |
| `.github/workflows/release.yml` | zip に `icons/` を同梱 |
| `CHANGELOG.md` | v3.16.0 の項を追加 |

アイコンのデザイン方針: カレンダーを想起させる角丸四角に、グループを表す色違いのチップ(丸または横長の帯)を 2〜3 個配置する。単色背景で 16px でも判別できる形にする。文字は入れない。

### 2. プライバシーポリシー(`PRIVACY.md`)

日本語を主とし、末尾に英語の要約を付ける。記載項目:

- 保存するデータ: グループ名とメンバーのカレンダー名、ピン留め、チップバーの位置、排他モード、アクティブグループ、検出済みカレンダー名、コーチマーク・Tips の表示済みフラグ
- 保存先: `chrome.storage.sync`(グループとピン留め)と `chrome.storage.local`(その他)。Google アカウントの同期機能により sync 領域は Google のサーバーを経由する
- 外部送信・第三者提供・アクセス解析・広告: 一切なし
- エクスポート: ユーザーの操作でのみ JSON ファイルを生成し、保存先はユーザーが選ぶ
- 予定の内容・参加者・メールアドレスは読み取らない
- 削除方法: 拡張をアンインストールすると local は消える。sync はアンインストール時に Chrome が削除する
- 問い合わせ先: GitHub Issues の URL
- 改定日

申請フォームに書く URL: `https://github.com/Ptaka/gcal-groups/blob/main/PRIVACY.md`

### 3. ストア掲載素材(`store/`)

| ファイル | 寸法 | 用途 |
|---|---|---|
| `store/screenshots/01-overview.png` 〜 `04-pin-export.png` | 1280×800 | スクリーンショット 4 枚 |
| `store/promo-small.png` | 440×280 | 小プロモタイル |
| `store/icon-128.png` | 128×128 | ストアアイコン(`icons/icon-128.png` と同一) |
| `store/listing.md` | - | 掲載文と申請フォームの回答案 |

スクリーンショットは `docs/images/` のマスク済みキャプチャを HTML テンプレートに配置し、Chrome headless で撮影する。実データの再撮影は行わない。各枚の構成:

1. チップバーの全体像(hero.png)とキャッチコピー
2. チップをクリックしてまとめて ON/OFF(chip-bar.png、demo.gif の静止フレーム)
3. 管理パネルでグループを作る(panel.png、member-editor.png)
4. ピン留めとエクスポート/インポート(テキスト中心)

`store/listing.md` の項目:

- 名前: Google Calendar グループ切替
- 概要(132 字以内)
- 詳細説明(README の「こんなときに」「毎日の使いかた」を再構成)
- カテゴリ: 仕事効率化
- 言語: 日本語
- ホームページ URL / サポート URL: GitHub リポジトリ / Issues
- 単一目的の説明
- 権限の理由: `storage`(グループ設定の保存)、ホスト権限 `calendar.google.com`(サイドバーの操作)
- データ使用の開示: 「ウェブサイトのコンテンツ」をローカル保存として申告し、3 つの証明にチェック
- リモートコード: 使用しない

### 4. 公開後

- ストア URL 確定後、README のインストール手順の先頭に「Chrome Web Store から」を追加する。zip 手順は残す
- 以後のリリースは、タグ push で Release zip を作り、同じ zip を手動でストアにアップロードする

## 進め方

1. feature/chrome-web-store ブランチで 1〜3 を実装し、PR を作る
2. マージ後に v3.16.0 タグを push して Release zip を得る
3. zip をストアにアップロードし、`store/listing.md` の内容をフォームに転記して審査に出す(ユーザーが行う)
4. 公開後に 4 を行う

## 検証

- アイコン付きの拡張を `chrome://extensions` に読み込み、一覧とツールバーにアイコンが表示される
- Release zip を展開し、`icons/` の 4 ファイルが含まれる
- `store/` の全画像を `sips` で寸法確認する。PNG は透過なし
- `PRIVACY.md` の URL に未認証でアクセスできる

## 対象外

- ストアへの自動アップロード(GitHub Actions)
- 英語版の掲載文(将来対応)
- 既存キャプチャの再撮影
