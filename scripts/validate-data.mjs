#!/usr/bin/env node
/* ============================================================
   AI転職ナビ — data.js 検証ゲート（依存ゼロ・Node ESM）

   月次自動更新が data.js を書き換えた後、main に push する前に通す
   「最後の砦」。誤った年収データや UI を壊す変更を本番に出さない。

   設計哲学（重要）：data.js の「正解の構造」をハードコードしない。
   将来スキル・職種・セクションが増減しても、検証スクリプトを直さずに
   動き続けるよう、次の3層で構成する：
     - Tier 1: データ単体で完結する普遍ルール（項目数に依存しない）
     - Tier 2: index.html を契約のソースにした相対整合（UI 即死を防ぐ本丸）
     - Tier 3: 前回コミットとの相対比較（計算式 model{} の暴走検知）
   → index.html と data.js を整合的に変えれば自動追従して通り、
     片方だけ変えた（＝UI が壊れる）ときだけ止まる。

   使い方:
     node scripts/validate-data.mjs [path=data.js]
       [--strict]                  ERROR が1件でもあれば exit 1（既定は常に 0）
       [--expect-date YYYY-MM-DD]  meta.last_updated がこの日付か検証（JST 当日）
       [--html path]               UI 契約の照合元（既定: data.js と同階層の index.html）
   ============================================================ */
import { readFileSync, appendFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import vm from "node:vm";
import { execSync } from "node:child_process";

// ---- CLI 引数パース ----
const args = process.argv.slice(2);
let DATA_PATH = null, STRICT = false, EXPECT_DATE = null, HTML_PATH = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--strict") STRICT = true;
  else if (a === "--expect-date") EXPECT_DATE = args[++i];
  else if (a === "--html") HTML_PATH = args[++i];
  else if (!a.startsWith("--")) DATA_PATH = a;
}
DATA_PATH = resolve(DATA_PATH || "data.js");
HTML_PATH = HTML_PATH ? resolve(HTML_PATH) : join(dirname(DATA_PATH), "index.html");

const E = [], W = [];                         // ERROR / WARN 集計
const err = (m) => E.push(m);
const warn = (m) => W.push(m);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// data.js / 旧 data.js を node:vm で評価して window.SALARY_DATA を取り出す。
// 構文エラーは throw されるので (a) の検出そのものになる。
function loadDataJs(src) {
  const ctx = { window: {}, console, navigator: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "data.js", timeout: 2000 });
  return ctx.window.SALARY_DATA;
}

// index.html から `const <name> = { ... }` のオブジェクトリテラルを切り出し、
// vm で評価してトップレベルのキー集合を返す。抽出/評価に失敗したら null
// （＝呼び出し側は WARN にフォールバックし、自動更新は止めない）。
function extractLiteralKeys(htmlSrc, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*\\{`).exec(htmlSrc);
  if (!m) return null;
  const open = m.index + m[0].length - 1;     // '{' の位置
  const block = sliceBalanced(htmlSrc, open); // 対応する '}' まで（文字列を考慮）
  if (!block) return null;
  try {
    const ctx = {};
    vm.createContext(ctx);
    const obj = vm.runInContext("(" + block + ")", ctx, { timeout: 1000 });
    return obj && typeof obj === "object" ? new Set(Object.keys(obj)) : null;
  } catch { return null; }
}
// s[open]==='{' から対応する '}' までを返す。'/"/` の文字列リテラル内の波括弧は無視。
function sliceBalanced(s, open) {
  let depth = 0, str = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (str) {
      if (c === "\\") { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { str = c; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(open, i + 1);
  }
  return null;
}

// 全数値を再帰走査：有限かつ非負。lo/hi を持つオブジェクトは lo<hi。
function walkNumbers(node, path = "$") {
  if (node == null) return;
  if (typeof node === "number") {
    if (!Number.isFinite(node)) err(`数値健全性: ${path} が有限でない (${node})`);
    else if (node < 0) err(`数値健全性: ${path} が負値 (${node})`);
    return;
  }
  if (Array.isArray(node)) { node.forEach((v, i) => walkNumbers(v, `${path}[${i}]`)); return; }
  if (typeof node === "object") {
    if (isNum(node.lo) && isNum(node.hi) && !(node.lo < node.hi))
      err(`数値健全性: ${path} の lo<hi 違反 (lo=${node.lo}, hi=${node.hi})`);
    for (const [k, v] of Object.entries(node)) walkNumbers(v, `${path}.${k}`);
  }
}

// data.js 内に現れる全 srcId 値を汎用収集（新セクションが srcId を持っても拾う）。
function collectSrcIds(node, acc = []) {
  if (Array.isArray(node)) node.forEach((v) => collectSrcIds(v, acc));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "srcId" && typeof v === "string") acc.push(v);
      else collectSrcIds(v, acc);
    }
  }
  return acc;
}

function todayJST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

try {
  // ===== ロード (a) =====
  let D;
  try {
    D = loadDataJs(readFileSync(DATA_PATH, "utf8"));
  } catch (e) {
    console.error(`[ERROR] (a) data.js を評価できません（構文エラー等）: ${e.message}`);
    process.exit(1);
  }
  if (!D || typeof D !== "object") {
    console.error("[ERROR] (a) window.SALARY_DATA が未定義または非オブジェクトです");
    process.exit(1);
  }

  // ===== Tier 1: 普遍チェック（構造非依存） =====
  // (b) 必須キーの存在のみ（余剰・新セクションは許容＝スキーマ進化を妨げない）
  for (const k of ["meta", "tiers", "sources", "model"])
    if (!(k in D)) err(`(b) 必須トップレベルキー欠落: ${k}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(D.meta?.last_updated || ""))
    err(`(b) meta.last_updated が YYYY-MM-DD 形式でありません: "${D.meta?.last_updated}"`);

  // 数値健全性（有限・非負・lo<hi）
  walkNumbers(D);

  // (c) 参照整合：全 srcId が sources に実在
  const sourceIds = new Set(Object.keys(D.sources || {}));
  for (const id of collectSrcIds(D))
    if (!sourceIds.has(id)) err(`(c) 参照整合: srcId "${id}" が sources に存在しません`);

  // (c2) 出典 URL の健全性：全 sources[].url が http(s):// で始まる
  // （index.html は safeUrl() で javascript: 等を弾くが、データ側でも担保する）
  for (const [sid, s] of Object.entries(D.sources || {}))
    if (!/^https?:\/\//i.test(String(s?.url || "")))
      err(`(c2) 出典URL不正: sources.${sid}.url が http(s):// で始まりません: ${JSON.stringify(s?.url)}`);

  // (d) tier 整合：sources[].tier と model.tier が tiers に実在、各 rank は数値
  const tierIds = new Set(Object.keys(D.tiers || {}));
  for (const [sid, s] of Object.entries(D.sources || {}))
    if (s?.tier && !tierIds.has(s.tier)) err(`(d) tier整合: sources.${sid}.tier "${s.tier}" が tiers に存在しません`);
  if (D.model?.tier && !tierIds.has(D.model.tier)) err(`(d) tier整合: model.tier "${D.model.tier}" が tiers に存在しません`);
  for (const [tid, t] of Object.entries(D.tiers || {}))
    if (!isNum(t?.rank)) err(`(d) tiers.${tid}.rank が数値でありません`);

  // 既知フィールドの妥当域（キー数に依存せず各値だけ見る＝項目が増えても OK）
  const SAL = [200, 3000], MUL = [0.5, 2.0], ROLEMUL = [0.6, 1.5], PREM = [0, 0.40], CAP = [0, 1];
  const inRange = (v, [lo, hi]) => isNum(v) && v >= lo && v <= hi;
  (D.benchmarks || []).forEach((b, i) => { if (!inRange(b.avg, SAL)) err(`(e) benchmarks[${i}].avg 域外(${SAL.join("〜")}万): ${b.avg}`); });
  (D.ageBands || []).forEach((a, i) => {
    if (!inRange(a.lo, SAL)) err(`(e) ageBands[${i}].lo 域外: ${a.lo}`);
    if (!inRange(a.hi, SAL)) err(`(e) ageBands[${i}].hi 域外: ${a.hi}`);
  });
  (D.companies || []).forEach((c, i) => {
    if (!inRange(c.mul, MUL)) err(`(e) companies[${i}].mul 域外(${MUL.join("〜")}): ${c.mul}`);
    if (typeof c.range !== "string" || !/\d/.test(c.range)) err(`(e) companies[${i}].range が数字を含む文字列でない: ${JSON.stringify(c.range)}`);
  });
  for (const [k, v] of Object.entries(D.model?.roleMul || {})) if (!inRange(v, ROLEMUL)) err(`(e) model.roleMul.${k} 域外(${ROLEMUL.join("〜")}): ${v}`);
  for (const [k, v] of Object.entries(D.model?.skillPrem || {})) if (!inRange(v, PREM)) err(`(e) model.skillPrem.${k} 域外(${PREM.join("〜")}): ${v}`);
  if (D.model && !inRange(D.model.premCap, CAP)) err(`(e) model.premCap 域外(${CAP.join("〜")}): ${D.model.premCap}`);
  // (g2) 勤務地補正 locationMul（任意セクション＝無ければ skip）。各倍率は現実域 0.8〜1.25 に収める（過大/過小評価防止）。
  const LOCMUL = [0.8, 1.25];
  if (D.model && D.model.locationMul) {
    const lm = D.model.locationMul;
    if (typeof lm !== "object" || Array.isArray(lm)) err(`(g2) model.locationMul はオブジェクトである必要があります: ${JSON.stringify(lm)}`);
    else for (const [k, v] of Object.entries(lm)) if (!inRange(v, LOCMUL)) err(`(g2) model.locationMul.${k} 域外(${LOCMUL.join("〜")}): ${v}`);
  }

  // (e2) model.expCurve（経験→中央値の点列）の健全性：
  //   各点が [数値,数値] / 中央値が現実域(SAL) / 年が単調増加（baseByExp の線形補間が破綻しないため）。
  if (D.model && "expCurve" in D.model) {
    const ec = D.model.expCurve;
    if (!Array.isArray(ec) || ec.length < 2) {
      err(`(e2) model.expCurve は2点以上の配列である必要があります: ${JSON.stringify(ec)}`);
    } else {
      let prevYear = -Infinity;
      ec.forEach((pt, i) => {
        if (!Array.isArray(pt) || pt.length !== 2 || !isNum(pt[0]) || !isNum(pt[1])) {
          err(`(e2) model.expCurve[${i}] が [年:数値, 中央値:数値] 形式でありません: ${JSON.stringify(pt)}`);
          return;
        }
        const [year, med] = pt;
        if (!inRange(med, SAL)) err(`(e2) model.expCurve[${i}] の中央値 ${med} が現実域(${SAL.join("〜")}万)外`);
        if (year <= prevYear) err(`(e2) model.expCurve[${i}] の年 ${year} が単調増加でありません（前=${prevYear}）`);
        prevYear = year;
      });
    }
  }

  // (f) 鮮度：last_updated が実行当日（JST）と一致
  const expect = EXPECT_DATE || todayJST();
  if (D.meta?.last_updated !== expect)
    err(`(f) 鮮度: meta.last_updated が当日(JST=${expect})と一致しません: "${D.meta?.last_updated}"（再調査が反映されていない可能性）`);

  // (g2) 年齢アンカー二層 / 上乗せ / 昇給 / 分散の健全性（正確性改修 2026-06。いずれも任意セクション＝無ければ skip）
  for (const key of ["ageAnchor", "ageAnchorNational"]) {
    const A = D[key];
    if (!A) continue;
    if (A.srcId && !sourceIds.has(A.srcId)) err(`(g2) ${key}.srcId "${A.srcId}" が sources に存在しません`);
    if (!Array.isArray(A.points) || A.points.length < 2) { err(`(g2) ${key}.points は2点以上の配列が必要`); continue; }
    let prevAge = -Infinity;
    A.points.forEach((p, i) => {
      if (!isNum(p.age)) err(`(g2) ${key}.points[${i}].age が数値でない`);
      else { if (p.age <= prevAge) err(`(g2) ${key}.points[${i}].age が昇順でない（前=${prevAge}）`); prevAge = p.age; }
      if (!inRange(p.p50, SAL)) err(`(g2) ${key}.points[${i}].p50 ${p.p50} が現実域(${SAL.join("〜")}万)外`);
      const q = [p.p25, p.p50, p.p75, p.p90].filter(v => isNum(v));   // 存在する percentile のみ順序検証
      for (let j = 1; j < q.length; j++) if (q[j] < q[j-1]) err(`(g2) ${key}.points[${i}] の percentile が p25≤p50≤p75≤p90 でない: ${JSON.stringify(q)}`);
    });
  }
  if (D.spread) {
    if (D.spread.tier !== "tool") warn(`(g2) spread.tier は "tool" が想定（現: ${D.spread.tier}）`);
    const r = D.spread.ratio || {};
    if (!(isNum(r.p25) && isNum(r.p75) && isNum(r.p90) && r.p25 < 1 && 1 < r.p75 && r.p75 < r.p90))
      err(`(g2) spread.ratio は p25<1<p75<p90 を満たす必要: ${JSON.stringify(r)}`);
  }
  if (D.aiPremium) {
    if (D.aiPremium.srcId && !sourceIds.has(D.aiPremium.srcId)) err(`(g2) aiPremium.srcId が sources に存在しません`);
    if (!inRange(D.aiPremium.cap, [1.0, 1.4])) err(`(g2) aiPremium.cap ${D.aiPremium.cap} が [1.0,1.4] 外`);
    (D.aiPremium.byAgeBand || []).forEach((b, i) => {
      if (!(isNum(b.mul) && b.mul >= 1.0 && b.mul <= D.aiPremium.cap))
        err(`(g2) aiPremium.byAgeBand[${i}].mul ${b.mul} が [1.0, cap=${D.aiPremium.cap}] 外（過大評価防止）`);
    });
  }
  if (D.raiseOnChange) {
    const ro = D.raiseOnChange;
    if (ro.srcId && !sourceIds.has(ro.srcId)) err(`(g2) raiseOnChange.srcId が sources に存在しません`);
    if (!(isNum(ro.upRatio) && ro.upRatio >= 0 && ro.upRatio <= 1)) err(`(g2) raiseOnChange.upRatio ${ro.upRatio} が [0,1] 外`);
    if (ro.avgRaiseIfUp != null && !(isNum(ro.avgRaiseIfUp) && ro.avgRaiseIfUp >= 0)) err(`(g2) raiseOnChange.avgRaiseIfUp が非負数でない`);
  }

  // ===== Tier 2: index.html 相対整合（UI 即死防止の本丸） =====
  let htmlSrc = null;
  try { htmlSrc = readFileSync(HTML_PATH, "utf8"); }
  catch { warn(`Tier2: index.html を読めません（${HTML_PATH}）。UI 整合チェックを skip`); }
  if (htmlSrc) {
    const compare = (nameA, setA, nameB, setB) => {
      const onlyB = [...setB].filter((k) => !setA.has(k)); // UI が参照するがデータに無い
      const onlyA = [...setA].filter((k) => !setB.has(k)); // データにあるが UI 辞書に無い
      if (onlyB.length) err(`Tier2: ${nameB} のキー {${onlyB.join(",")}} が ${nameA} に無い（UI が参照するデータ欠落→画面が壊れます）`);
      if (onlyA.length) err(`Tier2: ${nameA} のキー {${onlyA.join(",")}} が ${nameB} に無い（データはあるが UI 辞書が無い→画面が壊れます）`);
    };
    const skillMetaKeys = extractLiteralKeys(htmlSrc, "skillMeta");
    const roleLabelKeys = extractLiteralKeys(htmlSrc, "roleLabel");
    const skillPremKeys = new Set(Object.keys(D.model?.skillPrem || {}));
    if (skillMetaKeys) compare("model.skillPrem", skillPremKeys, "index.html skillMeta", skillMetaKeys);
    else warn("Tier2: index.html から skillMeta を抽出できず（書き方が変わった？）。skillPrem 整合チェックを skip");
    if (roleLabelKeys) compare("model.roleMul", new Set(Object.keys(D.model?.roleMul || {})), "index.html roleLabel", roleLabelKeys);
    else warn("Tier2: index.html から roleLabel を抽出できず。roleMul 整合チェックを skip");
    // companies[].fit は相性判定で sel.skills（=skillPrem キー）と filter 照合される。
    // 区別：
    //  - skillPrem 外 かつ roleMul 内のキー＝「職種キー取り違え」（fit にスキルでなく職種を入れた）
    //    → 相性が永遠に 0 になる実害バグ。ERROR で止める。
    //  - それ以外の未知キー（typo 等）＝ index.html 側で安全に無視され画面は壊れない → WARN。
    const roleMulKeys = new Set(Object.keys(D.model?.roleMul || {}));
    (D.companies || []).forEach((c, i) => (c.fit || []).forEach((k) => {
      if (skillPremKeys.has(k)) return;
      if (roleMulKeys.has(k)) err(`Tier2: companies[${i}].fit の "${k}" は職種キー(roleMul)です（スキルキー取り違え→相性判定が常に不成立）。skillPrem のキーに修正してください`);
      else warn(`Tier2: companies[${i}].fit の "${k}" が model.skillPrem に無い（相性判定で無視されます。意図通りか確認を）`);
    }));
  }

  // ===== Tier 3: 計算式 model{} の前回比乖離（暴走検知・相対比較） =====
  let prev = null;
  try {
    const prevSrc = execSync("git show HEAD:data.js", { cwd: dirname(DATA_PATH), encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    prev = loadDataJs(prevSrc);
  } catch { warn("Tier3: 前回 data.js を取得できず（初回コミット等）。計算式の乖離チェックを skip"); }
  if (prev?.model && D.model) {
    const DRIFT = 0.30;
    const checkDrift = (label, a, b) => {
      if (!isNum(a) || !isNum(b)) return;
      const rel = a === 0 ? (b === 0 ? 0 : 1) : Math.abs(b - a) / Math.abs(a);
      if (rel > DRIFT) err(`Tier3 (g) 計算式の暴走疑い: model.${label} が前回比 ${(rel * 100).toFixed(0)}% 乖離 (${a} → ${b})。UPDATE.md は「model は安易にいじらない」と明記`);
    };
    for (const k of Object.keys(prev.model.roleMul || {})) if (k in (D.model.roleMul || {})) checkDrift(`roleMul.${k}`, prev.model.roleMul[k], D.model.roleMul[k]);
    for (const k of Object.keys(prev.model.skillPrem || {})) if (k in (D.model.skillPrem || {})) checkDrift(`skillPrem.${k}`, prev.model.skillPrem[k], D.model.skillPrem[k]);
    checkDrift("premCap", prev.model.premCap, D.model.premCap);
  }

  // ===== レポート =====
  const expectShown = EXPECT_DATE || todayJST();
  console.log("");
  console.log("=== AI転職ナビ data.js 検証レポート ===");
  console.log(`対象     : ${DATA_PATH}`);
  console.log(`基準日JST : ${expectShown}${EXPECT_DATE ? " (--expect-date)" : ""}`);
  console.log(`結果     : ERROR ${E.length} 件 / WARN ${W.length} 件`);
  if (E.length) { console.log("\n[ERROR]（push を中止する致命的問題）"); E.forEach((m) => console.log("  ✗ " + m)); }
  if (W.length) { console.log("\n[WARN]（注意・push は継続）"); W.forEach((m) => console.log("  ! " + m)); }
  if (!E.length && !W.length) console.log("\n✓ 問題は検出されませんでした");
  console.log("");

  // GitHub Actions のステップサマリにも出す（あれば）
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      const md = [`## data.js 検証: ERROR ${E.length} / WARN ${W.length}`,
        ...E.map((m) => `- ❌ ${m}`), ...W.map((m) => `- ⚠️ ${m}`), ""].join("\n");
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    } catch { /* サマリ書込失敗は無視 */ }
  }

  process.exit(STRICT && E.length > 0 ? 1 : 0);
} catch (e) {
  // 想定外の例外は fail-closed（push を止める）
  console.error("[ERROR] 検証中に予期せぬ例外: " + (e?.stack || e?.message || e));
  process.exit(1);
}
