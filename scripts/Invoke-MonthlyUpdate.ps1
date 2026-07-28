<#
.SYNOPSIS
  年収データ（data.js）の月次更新をローカルで実行する。GitHub Actions の monthly-update.yml の後継。

.DESCRIPTION
  公式の Codex GitHub Action は OPENAI_API_KEY（従量課金）が必須で、ChatGPT サブスクの
  認証を渡せない。追加課金なしで回すため実行を手元へ移した。

  yml から 1:1 で移したもの:
    - JST 日付の算出
    - 冪等ガード（data.js の last_updated が当月なら何もしない）
    - 再調査と data.js の書き換え（LLM）
    - 検証ゲート（validate-data.mjs --strict）。**不合格なら push しない**
    - 合格時のみ commit + push
    - 不合格時は検証レポートと差分を添えて Issue を起票（同月の重複は起票しない）

  ローカル化で変わったところ:
    - gh / git は認証済みなので GITHUB_TOKEN の差し替えと git remote set-url が要らない
      （yml では claude-code-action が origin のトークンを上書きするので毎回戻していた）
    - コミット作者を bot ではなく通常のユーザーにした（手元で回すため）

  プロンプトは prompts/monthly.md に外出ししてある。

.PARAMETER Date
  対象日（yyyy-MM-dd）。省略時は今日（JST）。

.PARAMETER Force
  当月分が更新済みでも再実行する。

.PARAMETER SkipPush
  検証まで行い push しない。中身を見てから公開したいとき。

.PARAMETER DryRun
  LLM を起動せず、日付算出・冪等ガード・検証・配線だけ確認する。
#>
[CmdletBinding()]
param(
    [string]$Date = "",
    [switch]$Force,
    [switch]$SkipPush,
    [switch]$DryRun,
    [int]$TimeoutMinutes = 40
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:USERPROFILE '.agents\scheduled-scripts\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ((Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '_ai-career-navigator.log')

function Write-Log {
    param([string]$m)
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Output $line
}

function Resolve-CodexExe {
    $cache = Join-Path $env:USERPROFILE '.agents\state\codex-path.txt'
    if (Test-Path $cache) {
        $p = (Get-Content $cache -First 1).Trim()
        if ($p -and (Test-Path $p)) { return $p }
    }
    $found = Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin\*\codex.exe" -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending
    foreach ($f in $found) {
        if ((& $f.FullName --version 2>&1 | Out-String) -match 'codex') {
            New-Item -ItemType Directory -Force -Path (Split-Path $cache) | Out-Null
            Set-Content -Path $cache -Value $f.FullName -Encoding UTF8
            return $f.FullName
        }
    }
    throw 'codex.exe が見つからない'
}

function Invoke-Codex {
    param([string]$PromptPath, [hashtable]$Vars)

    $text = Get-Content -LiteralPath $PromptPath -Raw -Encoding utf8
    foreach ($k in $Vars.Keys) { $text = $text.Replace('{{' + $k + '}}', $Vars[$k]) }
    $left = [regex]::Matches($text, '\{\{[A-Z_]+\}\}')
    if ($left.Count) { throw ("プロンプトに未置換の変数が残っている: " + (($left | ForEach-Object { $_.Value }) -join ', ')) }

    if ($DryRun) {
        Write-Log ("DRY: プロンプトを組み立てた（{0} 文字）。codex は起動しない" -f $text.Length)
        return
    }

    $outFile = Join-Path $logDir ((Get-Date -Format 'HHmmss') + '_monthly_last.txt')
    $codexArgs = @(
        'exec', '--skip-git-repo-check',
        '-C', $repo, '--add-dir', $repo,
        '-s', 'danger-full-access',
        '-c', 'approval_policy="never"',
        '-c', 'model_reasoning_effort="high"',
        '-c', 'tools.web_search=true',
        '--dangerously-bypass-hook-trust',
        '-o', $outFile
    )
    Write-Log 'codex exec 開始'

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = (Resolve-CodexExe)
    foreach ($a in $codexArgs) { [void]$psi.ArgumentList.Add($a) }
    $psi.WorkingDirectory = $repo
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    # 標準入力の既定はコンソールのコードページ（日本語環境では cp932）。明示しないと
    # 日本語プロンプトが壊れ、codex が「input is not valid UTF-8」で即座に落ちる。
    $psi.StandardInputEncoding = New-Object System.Text.UTF8Encoding($false)
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8

    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.StandardInput.Write($text)
    $proc.StandardInput.Close()
    $so = $proc.StandardOutput.ReadToEndAsync()
    $se = $proc.StandardError.ReadToEndAsync()

    if (-not $proc.WaitForExit($TimeoutMinutes * 60 * 1000)) {
        Write-Log ("ERROR: {0}分で打ち切り" -f $TimeoutMinutes)
        try { taskkill /PID $proc.Id /T /F 2>&1 | Out-Null } catch {}
        throw '再調査がタイムアウトした'
    }
    Add-Content -Path $logFile -Value $so.Result -Encoding UTF8
    if ($se.Result) { Add-Content -Path $logFile -Value $se.Result -Encoding UTF8 }
    Write-Log ("codex exec 終了 exitCode={0}" -f $proc.ExitCode)
    if ($proc.ExitCode -ne 0) { throw "再調査が exitCode=$($proc.ExitCode) で失敗" }
}

function New-FailureIssue {
    param([string]$DateStr, [string]$Report)
    # DryRun は配線確認であって本番の失敗ではない。偽の Issue を立てない。
    if ($DryRun) { Write-Log 'DRY: 検証失敗の Issue は起票しない'; return }

    $ym = $DateStr.Substring(0, 7)
    $existing = 0
    try {
        $existing = (& gh issue list --repo pandas-mizugorou/ai-career-navigator --state open `
            --search "月次更新 $ym in:title" --json number --jq 'length' 2>$null)
    } catch {}
    if ([int]$existing -gt 0) { Write-Log "同月($ym)の Issue が既にあるため起票しない"; return }

    $diff = (& git diff -- data.js | Select-Object -First 300) -join "`n"
    $body = @(
        '月次自動更新で再調査後の data.js が検証ゲートで不合格になり、**push を中止**しました。',
        '壊れたデータは公開されていません（前回の data.js が引き続き表示されています）。',
        '',
        '## 検証エラー',
        '```',
        $Report,
        '```',
        '',
        '## 変更差分（push されなかった内容・先頭300行）',
        '```diff',
        $diff,
        '```',
        '',
        '## 復旧の目安',
        '- 鮮度エラー（last_updated 未更新）→ `-Force` を付けて手元で再実行',
        '- 参照切れ / 域外 → `node scripts/validate-data.mjs --html index.html` で詳細を見る',
        '- model 乖離 → roleMul / skillPrem が想定外に動いた。差分を人手で確認',
        '',
        "実行ログ: $logFile"
    ) -join "`n"

    $bodyFile = Join-Path $logDir 'nav_issue_body.md'
    [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
    try {
        & gh issue create --repo pandas-mizugorou/ai-career-navigator `
            --title "⚠️ AI転職ナビ 月次更新 ${DateStr}: 検証失敗（push 中止）" `
            --body-file $bodyFile 2>&1 | ForEach-Object { Write-Log ("gh: " + $_) }
    } catch { Write-Log ("WARN: Issue 起票に失敗: " + $_.Exception.Message) }
}

Push-Location $repo
try {
    $jst = [System.TimeZoneInfo]::FindSystemTimeZoneById('Tokyo Standard Time')
    $nowJst = [System.TimeZoneInfo]::ConvertTime([datetime]::UtcNow, [System.TimeZoneInfo]::Utc, $jst)
    $target = if ($Date) { [datetime]::ParseExact($Date, 'yyyy-MM-dd', $null) } else { $nowJst.Date }
    $dateStr = $target.ToString('yyyy-MM-dd')
    $curYm = $target.ToString('yyyy-MM')
    Write-Log ("対象日={0}" -f $dateStr)

    & git pull --rebase --autostash 2>&1 | ForEach-Object { Write-Log ("git: " + $_) }

    # --- 冪等ガード: data.js の last_updated が当月なら何もしない ---
    $lu = ''
    $m = [regex]::Match((Get-Content -LiteralPath (Join-Path $repo 'data.js') -Raw -Encoding utf8), '"(\d{4}-\d{2}-\d{2})"')
    if ($m.Success) { $lu = $m.Groups[1].Value }
    Write-Log ("冪等ガード: data.js の last_updated={0} / 当月={1}" -f $lu, $curYm)
    if (-not $Force -and $lu.StartsWith($curYm)) {
        Write-Log '当月分は更新済みのためスキップ'
        exit 0
    }

    Invoke-Codex -PromptPath (Join-Path $repo 'prompts\monthly.md') -Vars @{ DATE = $dateStr }

    # --- 検証ゲート: ここが push の可否を決める ---
    $report = (& node scripts/validate-data.mjs --strict --expect-date $dateStr --html index.html 2>&1 | Out-String)
    $passed = ($LASTEXITCODE -eq 0)
    Add-Content -Path $logFile -Value $report -Encoding UTF8
    Write-Log ("検証: {0}" -f $(if ($passed) { '合格' } else { '不合格（push しない）' }))

    if (-not $passed) {
        if ($DryRun) {
            Write-Log 'DRY: 生成していないので鮮度エラーは想定どおり。ここで終える'
            exit 0
        }
        New-FailureIssue -DateStr $dateStr -Report $report.Trim()
        Write-Log '検証に落ちたため data.js は公開していない（前回の内容のまま）'
        exit 1
    }

    if ($DryRun) {
        & git checkout -- data.js 2>&1 | Out-Null
        Write-Log 'DRY: 差分を破棄し、コミットも push もしない'
        exit 0
    }

    if (-not (& git status --porcelain data.js)) {
        Write-Log 'data.js に変更なし。コミットしない'
        exit 0
    }
    & git add data.js
    # コミット作者は指定しない。~/.gitconfig の includeIf が personal 配下に
    # noreply アドレスを割り当てているので、ここで上書きすると
    # 会社メールが public リポに出てしまう。
    & git commit -q -m "monthly data update: $dateStr" 2>&1 | ForEach-Object { Write-Log ("git: " + $_) }
    if ($SkipPush) {
        Write-Log '-SkipPush のため push しない'
        exit 0
    }
    & git pull --rebase --autostash 2>&1 | ForEach-Object { Write-Log ("git: " + $_) }
    & git push origin HEAD:main 2>&1 | ForEach-Object { Write-Log ("git: " + $_) }
    if ($LASTEXITCODE -ne 0) { throw 'push に失敗' }
    Write-Log 'push 完了。GitHub Pages が自動で再デプロイする'
    exit 0
} catch {
    Write-Log ("ERROR: " + $_.Exception.Message)
    exit 1
} finally {
    Pop-Location
}
