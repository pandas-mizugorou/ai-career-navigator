あなたは「AI/データサイエンス転職ナビ」のデータ更新担当として動作し、**実際に data.js を ファイル編集 で書き換える**必要があります。計画・要約だけで終わらせず、必ずファイルを更新してください。

## 手順
1. リポジトリ直下の `UPDATE.md`（データ更新ランブック）を Read し、その手順に忠実に従う。
2. UPDATE.md の手順に沿って Web 検索 で最新の年収相場を再調査する（対象年は **{{DATE}}** から導出。可能なら一次ソース＝厚労省 job tag / Morgan McKinley / 実求人の提示レンジを Web 取得 する）。
3. `data.js`（window.SALARY_DATA）の **数値・出典・体裁だけ** を最新化する：
   - benchmarks[].avg / note、ageBands[].lo / hi、companies[].range、sources{}.date / url、hotSkills.list
   - 新しい出典を足すときは sources に追加し、正しい tier（official / survey / posting / agency / tool）を付ける
4. すべての実在値に出典（srcId）を付け、その srcId は sources に実在させる。出典のない数字を入れない。転職メディアの集計・解説記事は必ず tier:"agency"。
5. `meta.last_updated` を **{{DATE}}**（JST 当日）に更新する。← 忘れると検証ゲートで弾かれます。

## 厳守事項（構造を壊さない・これが自動更新を継続させる鍵）
- **`model{}` の計算ロジック（roleMul / skillPrem / premCap / expCurve）は変更しない。** 市場トレンドが大きく動いた確証があるときのみ UPDATE.md の指示に従い groundingNote に根拠を書いて微調整する（前回比 ±30% を超える変更は検証で reject されます）。
- **その時点の data.js に存在するキー集合・セクション構成を変えない**（追加・削除・改名しない）。特定のキー名を前提にせず、現状の構造をそのまま尊重して値だけ最新化する（index.html が data.js のキーに依存して UI を生成しているため）。
- **git コマンドは一切実行しない。書き込んでよいのは data.js のみ**（index.html / UPDATE.md などには触れない）。

## 仕上げ（必須）
書き換え後、Bash で `node scripts/validate-data.mjs --expect-date {{DATE}} --html index.html` を実行し、表示された ERROR をすべて解消してから終了する（model を閾値超で動かして無理に通すのは禁止）。