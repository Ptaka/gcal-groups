# CLAUDE.md

## 言語

- 会話・コメント・ドキュメントは日本語

## READMEキャプチャの運用

- チップバー・管理パネル・バッジ・コーチマークなど**UIに見える変更**を入れたら、READMEの該当説明と `docs/images/` のキャプチャ・デモGIFを併せて更新する
- 撮影とマスキングの手順は `/update-readme-captures` スキルに従う。**マスクなしの実データキャプチャを docs/ に置くことは禁止**
- キャプチャのファイル名は据え置きにしてREADMEのリンクを壊さない: `demo.gif` / `hero.png` / `chip-bar.png` / `panel.png` / `member-editor.png`

## リリース

- バージョンは `manifest.json` の `version` が正。リリース時に `CHANGELOG.md` を更新し、gitタグ(`v3.15.0` 形式)をpushする
- タグをpushすると GitHub Actions(`.github/workflows/release.yml`)が配布用zipを作成してReleaseに添付する。タグとmanifestのバージョン不一致はエラーになる
- コード変更を含む作業はfeatureブランチ+PRで行う(mainへの直pushはドキュメントのみの変更に限る)
