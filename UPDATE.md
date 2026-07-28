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

## データ層の二層構造と更新ルール

`data.js` は **更新頻度と人手関与の違いで 2 層** に分かれる。月次自動更新が触れてよい範囲を厳密に限定し、推定の土台（アンカー・分散・補正係数・計算式）が毎月ブレて信頼性を損なうのを防ぐ。

### 年次同期（有人・原則 年1回。official 発表に合わせる）
次は **官公庁の年次統計が発表された時だけ、人間が** 同期する。**月次の自動更新では絶対に触らない**：

- `ageAnchor`（厚労省 賃金構造基本統計・ソフトウェア作成者の年齢別実測 p50）
- `ageAnchorNational`（国税庁 民間給与実態統計・年齢階級別平均）
- `spread`（年齢別分位 p25/p75/p90 の推定比。実測が公表されたら置換）
- `model.locationMul`（勤務地補正。全国平均=1.0 基準の地域別比）
- `model{}` 全体（`expCurve`/`roleMul`/`skillPrem`/`premCap`/`groundingNote` 等＝本ツール推定の計算式）

> 発表時期の目安：**国税庁 民間給与実態統計＝例年9月／厚労省 賃金構造基本統計＝例年3月**。これらの official source が更新されたタイミングで、対応するアンカー・係数を有人セッションで同期する。

### 月次自動更新が触れてよい範囲（ホワイトリスト）
`.github/workflows/monthly-update.yml` の自動更新が書き換えてよいのは **次だけ**：

- `benchmarks`（職種別平均 `avg`・`note`）
- `companies[].range`（企業タイプ別の市場レンジ文字列）
- `hotSkills`（需要スキルの入れ替え）
- `aiPremium.byAgeBand`（**値（`mul`）のみ**。`band` キー集合・構造は変えない）
- `raiseOnChange`（**値のみ**。`upRatio`/`avgRaiseIfUp` 等の数値更新）
- `sources` の `date`・`url`（時点更新・URL 差し替え）と **新しい agency ソースの追加**

**変更禁止（自動更新では触らない）**：`ageAnchor` ／ `spread` ／ `model.locationMul` ／ `model{}`（計算式）／ **既存キー集合（スキル・職種・勤務地・tier のキー）** ／ **新しいセクションや構造の追加**。これらは UI（`index.html`）と一体で設計されており、片側だけ変えると壊れる。構造を増減したい場合は「調査内容や項目を変えたいとき」の手順どおり **有人で index.html と一緒に** 変更する。

### 「盛らない」原則は両層に等しく適用
- **出典必須**：実在値には必ず `srcId`。出典のない数字を入れない（両層）。
- **cap を上げない**：`premCap`・`aiPremium.cap`・`locationMul` の上限域（0.8〜1.25）を、見栄えのために引き上げない。
- **不明は不明**：分位・中央値など非公表のものは推定と明示する（`spread`／`raiseOnChange.medianRaise=null` 等）。盛って実測に見せない。

---

## 自動更新（月次）

このランブックは **月 1 回 自動でも実行される**。上記の手順に従って Web 検索で再調査し `data.js` を書き換える。

> **現在このランブックの自動実行は休止している（2026-07-29）**。
>
> 実行系を GitHub Actions からローカルへ切り替えたが、再開の指示があるまで両方とも止めてある。
> 手元で実行する分には下記コマンドでいつでも動く。
>
> | 実行系 | 実体 | 状態 |
> |---|---|---|
> | GitHub Actions（旧） | `.github/workflows/monthly-update.yml`（`claude-code-action`） | `disabled_manually`。**役目を終えた**（Claude Code 撤去時にファイルごと削除する） |
> | ローカル（新） | `scripts/Invoke-MonthlyUpdate.ps1`（`codex exec`） | タスク `\Agents\AiCareerNavigatorMonthly` に登録済み・**Disabled** |
>
> 公式の Codex GitHub Action は `OPENAI_API_KEY`（従量課金）が必須で ChatGPT サブスクの認証を
> 渡せないため、追加課金なしで回すにはローカル実行しかない。それが切り替えた理由。
>
> **自動実行を再開するとき**は次のコマンドひとつ。GitHub Actions 側は無効のままにしておくこと
> （両方動くと同月に二重で `data.js` を書き換えて push が競合する）。
>
> ```powershell
> Enable-ScheduledTask -TaskName AiCareerNavigatorMonthly -TaskPath '\Agents\'
> ```
>
> ```powershell
> # ローカルで手動実行
> pwsh -File scripts\Invoke-MonthlyUpdate.ps1 -SkipPush   # 検証まで（公開しない）
> pwsh -File scripts\Invoke-MonthlyUpdate.ps1             # 検証に通れば公開
> pwsh -File scripts\Invoke-MonthlyUpdate.ps1 -Force      # 当月更新済みでも再実行
> pwsh -File scripts\Invoke-MonthlyUpdate.ps1 -DryRun     # LLM を起動せず配線だけ確認
> ```
>
> ローカル版のトリガーは「毎日 6:00 起動 ＋ 当月更新済みなら何もしない」にしてある。
> 月次トリガーだとその日 PC が落ちていたときに丸ごと 1 か月飛ぶため。

- **スケジュール**：毎月初（JST 早朝着）。GitHub Actions の遅延に備え多重 cron + 冪等ガード（当月分が既にあれば skip）。
- **検証ゲート（push 前の最後の砦）**：`scripts/validate-data.mjs`（依存ゼロ Node）が、構文・必須キー・出典参照（srcId→sources / tier→tiers）・数値妥当域・`last_updated` の当日性・`model{}` の前回比乖離（±30%）・**index.html との UI 整合**を検査する。**合格時のみ main に push（即公開）**。不合格なら push せず GitHub Issue で通知する（壊れたデータは本番に出ない）。
- **自己修復**：ランナー障害等で失敗したら `retry-failed.yml` が 1 回だけ自動再実行する。
- **手動実行**：Actions タブ →「Monthly Data Update」→ Run workflow（当月分が既にあるときは force=true）。
- **ローカル検証**：`node scripts/validate-data.mjs --html index.html`（レポートのみ）/ `--strict`（ERROR で exit 1）。
- **初回のみの手作業（GitHub Actions 側のみ）**：リポジトリの Settings → Secrets and variables → Actions に `CLAUDE_CODE_OAUTH_TOKEN` を登録（`claude setup-token` で発行、または ai-daily-digest と同じトークンを流用）。
  **ローカル実行に切り替えたあとはこの Secret は不要**（Codex は ChatGPT サブスクの認証を `~/.codex/auth.json` から使う）。

### 調査内容や項目を変えたいとき（重要）

将来この診断を改修して **調査する内容や `data.js` の項目が変わっても、月次自動更新は壊れず動き続ける** ように設計してある：

- **調査の内容（クエリ・対象ソース・更新するフィールド）を変えたい** → **この `UPDATE.md` を編集するだけ**でよい。月次の Claude プロンプトは本ファイルを読んで従うので、翌月から自動で追従する（ワークフローや検証スクリプトを触る必要はない）。
- **`data.js` の構造（スキル・職種・企業タイプ・セクション）を増減したい** → **`index.html` と `data.js` を一緒に**変更する（有人セッションで）。検証スクリプトは「index.html が参照するキー ＝ data.js が提供するキー」を見るので、両者を整合させれば自動更新はそのまま通り、**片方だけ変えた（＝UI が壊れる）ときだけ止めてくれる**。

> 自動更新もこの手順書に従う。原則（model は安易にいじらない／全数値に srcId／エージェント記事は agency／盛らない）は人手・自動の両方に等しく適用される。
