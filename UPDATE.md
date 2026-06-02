# AI転職ナビ — データ更新手順書（Claude Code 用ランブック）

このアプリの数値は **`data.js` だけ** が持っている（`index.html` はロジックのみ）。
更新とは「最新の市場データを再調査して `data.js` を書き換える」こと。

ユーザーが「**AI転職ナビのデータ更新して**」と言ったら、以下を実行する。

## 手順

1. **再調査（WebSearch）** — 次のクエリを最低限まわす（日本国内・最新年を明示）：
   - `データサイエンティスト 機械学習エンジニア 年収 相場 <年> 日本`
   - `AIエンジニア 年収 年代別 経験別 <年> 日本 求人ボックス job tag`
   - `生成AI LLM AIエージェント エンジニア 年収 求人 <年> 日本`
   - `AI人材 転職先 企業タイプ コンサル 金融 メガベンチャー 年収 <年>`
   - 可能なら一次ソースを直接 WebFetch（厚労省 job tag、Morgan McKinley 年収ガイド、実求人の提示レンジ）

2. **数値の差し替え** — `data.js` の以下を更新：
   - `benchmarks[]` … 職種別平均（`avg` と `note`）
   - `ageBands[]` … 年代別レンジ
   - `companies[].range` … 企業タイプ別の市場レンジ
   - `sources{}` … 各出典の `date` を取得時点に更新、URLが変わっていれば差し替え、新ソースは追加
   - `hotSkills.list` … 需要スキルの入れ替え

3. **信頼区分(tier)を正しく付ける** — 数値ごとに：
   - `official` 政府・公的統計（厚労省 job tag 等）
   - `survey` 人材会社の年収調査レポート（Morgan McKinley 等）
   - `posting` 実際の求人票の提示レンジ
   - `agency` 転職メディアの集計・解説記事（やや高めバイアスに注意）
   - `tool` 本ツールが組んだ計算ロジック（`model{}` 内。実測値ではない）

4. **`model{}` の扱い** — `roleMul`/`skillPrem` は「本ツール推定」。
   市場の単価差トレンドが大きく変わった時のみ調整し、`groundingNote` に根拠を書く。
   安易にいじらない（=毎回ブレると信頼性が下がる）。

5. **`meta.last_updated` を当日の日付（YYYY-MM-DD）に更新する。** ← これを忘れると陳腐化警告が誤作動する。

6. **動作確認** — `index.html` をブラウザで開き、上部バナーが新しい日付・緑ドットになっていること、
   各数値のバッジ（出典・時点）が表示されることを確認。

## 原則
- **すべての実在値に出典(`srcId`)を付ける。** 出典なしの数字を `benchmarks`/`companies` に入れない。
- **点ではなく幅で示す。** 平均は出典差が大きいので `note` に併記する。
- **エージェント記事は `agency` ラベルを必ず付ける**（高めバイアスを利用者に開示するため）。
- 数字を盛らない。不明なら「不明」と書く。

---

## 自動更新（月次・GitHub Actions）

このランブックは **月 1 回 自動でも実行される**。`.github/workflows/monthly-update.yml` が Claude Code（Opus）を起動し、上記の手順に従って WebSearch 再調査 → `data.js` を書き換える。

- **スケジュール**：毎月初（JST 早朝着）。GitHub Actions の遅延に備え多重 cron + 冪等ガード（当月分が既にあれば skip）。
- **検証ゲート（push 前の最後の砦）**：`scripts/validate-data.mjs`（依存ゼロ Node）が、構文・必須キー・出典参照（srcId→sources / tier→tiers）・数値妥当域・`last_updated` の当日性・`model{}` の前回比乖離（±30%）・**index.html との UI 整合**を検査する。**合格時のみ main に push（即公開）**。不合格なら push せず GitHub Issue で通知する（壊れたデータは本番に出ない）。
- **自己修復**：ランナー障害等で失敗したら `retry-failed.yml` が 1 回だけ自動再実行する。
- **手動実行**：Actions タブ →「Monthly Data Update」→ Run workflow（当月分が既にあるときは force=true）。
- **ローカル検証**：`node scripts/validate-data.mjs --html index.html`（レポートのみ）/ `--strict`（ERROR で exit 1）。
- **初回のみの手作業**：リポジトリの Settings → Secrets and variables → Actions に `CLAUDE_CODE_OAUTH_TOKEN` を登録（`claude setup-token` で発行、または ai-daily-digest と同じトークンを流用）。

### 調査内容や項目を変えたいとき（重要）

将来この診断を改修して **調査する内容や `data.js` の項目が変わっても、月次自動更新は壊れず動き続ける** ように設計してある：

- **調査の内容（クエリ・対象ソース・更新するフィールド）を変えたい** → **この `UPDATE.md` を編集するだけ**でよい。月次の Claude プロンプトは本ファイルを読んで従うので、翌月から自動で追従する（ワークフローや検証スクリプトを触る必要はない）。
- **`data.js` の構造（スキル・職種・企業タイプ・セクション）を増減したい** → **`index.html` と `data.js` を一緒に**変更する（有人セッションで）。検証スクリプトは「index.html が参照するキー ＝ data.js が提供するキー」を見るので、両者を整合させれば自動更新はそのまま通り、**片方だけ変えた（＝UI が壊れる）ときだけ止めてくれる**。

> 自動更新もこの手順書に従う。原則（model は安易にいじらない／全数値に srcId／エージェント記事は agency／盛らない）は人手・自動の両方に等しく適用される。
