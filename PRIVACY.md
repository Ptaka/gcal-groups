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
