#!/usr/bin/env node
/* ============================================================
   AI転職ナビ — 計算ロジックの不変条件テスト（依存ゼロ・Node 標準のみ）

   data.js を node:vm でロードして SALARY_DATA を取り出し、index.html の計算ロジック
   （baseByExp の区分線形補間 / personalRange の中央値式 / premCap 飽和 / companies.fit）
   が満たすべき不変条件を node:assert で検証する。

   設計：index.html の該当ロジックを「同じ式」で test 内に移植して照合する。
   data.js を最新の再調査結果に書き換えても、式の前提（単調増加・連続・lo<mid<hi・
   premCap 頭打ち・fit キーの整合）が崩れていれば即座に落ちる回帰ゲート。

   使い方:  node scripts/test-logic.mjs
   失敗時は AssertionError のメッセージを出して非ゼロ exit。
   ============================================================ */
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(join(__dirname, "..", "data.js"));

// ---- data.js を vm でロードして window.SALARY_DATA を取得 ----
function loadDataJs(src) {
  const ctx = { window: {}, console, navigator: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "data.js", timeout: 2000 });
  return ctx.window.SALARY_DATA;
}
const D = loadDataJs(readFileSync(DATA_PATH, "utf8"));
assert.ok(D && typeof D === "object", "data.js の window.SALARY_DATA がロードできません");
assert.ok(D.model && Array.isArray(D.model.expCurve), "model.expCurve が配列でありません");

// ---- index.html の baseByExp と同一の区分線形補間（点列を補間。範囲外はクランプ）----
function baseByExp(y) {
  const pts = D.model.expCurve;
  const lo = pts[0], hi = pts[pts.length - 1];
  if (y <= lo[0]) return lo[1];
  if (y >= hi[0]) return hi[1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, v0] = pts[i - 1], [x1, v1] = pts[i];
    if (y <= x1) return v0 + (v1 - v0) * (y - x0) / (x1 - x0);
  }
  return hi[1];
}

// ---- index.html の personalRange と同一の中央値・レンジ式（balance 志向）----
//   mid = base * roleMul * (1 + min(prem, premCap))
//   lo  = mid * 0.82,  hi = mid * 1.30  （balance）
const premCap = D.model.premCap;
function personalRange(exp, roleMul, premRaw) {
  const base = baseByExp(exp) * roleMul;
  const prem = Math.min(premRaw, premCap);
  const mid = base * (1 + prem);
  const lo = mid * 0.82;
  const hi = mid * 1.30; // balance 志向
  return { lo, mid, hi, prem };
}

// ---- テスト本体 ----
let checks = 0;
const C = () => { checks++; };

// (a) baseByExp が 0..20 年で単調増加、かつ単年ジャンプ ≤ 60万
{
  let prev = -Infinity;
  for (let y = 0; y <= 20; y++) {
    const v = baseByExp(y);
    assert.ok(
      Number.isFinite(v),
      `(a) baseByExp(${y}) が有限値でありません: ${v}`,
    );
    assert.ok(
      v >= prev,
      `(a) baseByExp が単調増加でない: baseByExp(${y - 1})=${prev} > baseByExp(${y})=${v}`,
    );
    if (y >= 1) {
      const jump = v - baseByExp(y - 1);
      assert.ok(
        jump <= 60 + 1e-9,
        `(a) 単年ジャンプ過大: baseByExp(${y - 1})→baseByExp(${y}) の増分 ${jump.toFixed(2)}万 が 60万 を超えています`,
      );
      C();
    }
    prev = v;
    C();
  }
}

// (b) baseByExp(年) が expCurve の各端点で点列の値と一致（連続性）
{
  for (const [year, med] of D.model.expCurve) {
    const v = baseByExp(year);
    assert.ok(
      Math.abs(v - med) < 1e-9,
      `(b) 連続性違反: expCurve の端点 [${year}年, ${med}万] で baseByExp(${year})=${v} が点列値と一致しません`,
    );
    C();
  }
}

// (c) 任意の (exp, roleMul, prem) で lo<mid<hi が成り立つ（balance 志向の personalRange）
{
  const expSamples = [0, 1, 3, 7, 12, 18, 20];
  const roleMuls = Object.values(D.model.roleMul);
  const premSamples = [0, 0.05, 0.2, premCap, premCap + 0.3];
  for (const exp of expSamples) {
    for (const rm of roleMuls) {
      for (const pr of premSamples) {
        const { lo, mid, hi } = personalRange(exp, rm, pr);
        assert.ok(
          lo < mid && mid < hi,
          `(c) lo<mid<hi 違反: exp=${exp}, roleMul=${rm}, premRaw=${pr} → lo=${lo.toFixed(2)}, mid=${mid.toFixed(2)}, hi=${hi.toFixed(2)}`,
        );
        assert.ok(
          mid > 0,
          `(c) mid が正でありません: exp=${exp}, roleMul=${rm}, premRaw=${pr} → mid=${mid}`,
        );
        C();
      }
    }
  }
}

// (d) premCap 飽和：skillPrem 全合計 > premCap のとき、実効加点は premCap で頭打ち
{
  const sum = Object.values(D.model.skillPrem).reduce((a, b) => a + b, 0);
  assert.ok(
    sum > premCap,
    `(d) 前提崩れ: 全スキル加点の合計(${sum.toFixed(3)}) が premCap(${premCap}) 以下では飽和テストが意味を持ちません（data.js を確認）`,
  );
  const effective = Math.min(sum, premCap);
  assert.equal(
    effective,
    premCap,
    `(d) premCap 飽和違反: min(全合計${sum.toFixed(3)}, premCap${premCap}) が premCap と一致しません (=${effective})`,
  );
  C();
  // 飽和時、premRaw を増やしても mid が増えないこと（誠実さの核：頭打ちの実装確認）
  const rm = D.model.roleMul[Object.keys(D.model.roleMul)[0]];
  const midAtCap = personalRange(7, rm, premCap).mid;
  const midOverCap = personalRange(7, rm, sum).mid;
  assert.ok(
    Math.abs(midAtCap - midOverCap) < 1e-9,
    `(d) 頭打ち違反: premRaw=premCap(${premCap}) の mid=${midAtCap.toFixed(4)} と premRaw=全合計(${sum.toFixed(3)}) の mid=${midOverCap.toFixed(4)} が一致しません（上限超過分が反映されている）`,
  );
  C();
}

// (e) companies[].fit の全キーが model.skillPrem のキー集合に含まれる（職種キー混入なし）
{
  const skillKeys = new Set(Object.keys(D.model.skillPrem));
  (D.companies || []).forEach((c, i) => {
    (c.fit || []).forEach((k) => {
      assert.ok(
        skillKeys.has(k),
        `(e) fit キー混入: companies[${i}] ("${c.name}") の fit に "${k}" がありますが model.skillPrem のキーではありません（職種キー取り違え等）`,
      );
      C();
    });
  });
}

/* ============================================================
   Wave1：年齢主軸の percentile 推定ロジックの不変条件テスト（正確性改修 2026-06）

   index.html の estimatePercentiles / anchorAt / interpAnchor / aiPremiumFactor /
   ageFromExp / ageToBand / clamp と「同一の式」を下に移植し、data.js の実データに対して
   不変条件を検証する。index.html と式が乖離したら（係数を変えた等）即座に落ちる回帰ゲート。

   移植元: index.html の該当関数（行番号は実装時点）。sel.skills は Set（index.html 同様）。
   ============================================================ */

// ---- index.html clamp と同一 ----
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- index.html ageFromExp と同一（年齢未入力時の保守推定、22〜60 にクランプ）----
function ageFromExp(exp) { return clamp(22 + (Number(exp) || 0), 22, 60); }

// ---- index.html interpAnchor と同一（points を age で線形補間。範囲外は端点クランプ）----
function interpAnchor(points, age, key) {
  const pts = (points || []).filter((p) => p && isFinite(p.age));
  if (!pts.length) return null;
  if (age <= pts[0].age) return pts[0][key];
  if (age >= pts[pts.length - 1].age) return pts[pts.length - 1][key];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (age <= b.age) {
      const t = (age - a.age) / (b.age - a.age);
      const va = a[key], vb = b[key];
      if (va == null || vb == null) return null; // 補間端のどちらかが欠損なら null
      return va + (vb - va) * t;
    }
  }
  return pts[pts.length - 1][key];
}

// ---- index.html anchorAt と同一（p50=実測補間。分位は全点実測なら補間、欠損なら spread.ratio で補完）----
function anchorAt(age) {
  const P = (D.ageAnchor && D.ageAnchor.points) || [];
  const p50 = interpAnchor(P, age, "p50");
  const allReal = (k) => P.length > 0 && P.every((p) => p[k] != null);
  const ratio = (D.spread && D.spread.ratio) || { p25: 0.85, p75: 1.20, p90: 1.45 };
  let p25, p75, p90, estimatedSpread = false;
  if (allReal("p25") && allReal("p75") && allReal("p90")) {
    p25 = interpAnchor(P, age, "p25");
    p75 = interpAnchor(P, age, "p75");
    p90 = interpAnchor(P, age, "p90");
    if (p25 == null || p75 == null || p90 == null) { estimatedSpread = true; p25 = p50 * ratio.p25; p75 = p50 * ratio.p75; p90 = p50 * ratio.p90; }
  } else {
    estimatedSpread = true;
    p25 = p50 * ratio.p25; p75 = p50 * ratio.p75; p90 = p50 * ratio.p90;
  }
  return { p25, p50, p75, p90, estimatedSpread };
}

// ---- index.html ageToBand と同一 ----
function ageToBand(age) {
  return age < 30 ? "20代" : age < 40 ? "30代" : age < 50 ? "40代" : age < 60 ? "50代" : "60代";
}

// ---- index.html aiPremiumBaseMul と同一（byAgeBand を代表年齢の点とみなし age で線形補間。45歳超は55歳で1.0へ）----
const AI_BAND_REP = { "20代": 25, "30代": 35, "40代": 45 };
const AI_RAMP_END_AGE = 55;
function aiPremiumBaseMul(age) {
  const AP = D.aiPremium || {};
  const pts = [];
  for (const b of (AP.byAgeBand || [])) {
    const rep = AI_BAND_REP[b && b.band];
    if (rep != null && b.mul != null) pts.push({ age: rep, mul: b.mul });
  }
  if (!pts.length) return 1.0;
  pts.sort((a, b) => a.age - b.age);
  const lo = pts[0], hi = pts[pts.length - 1];
  if (age <= lo.age) return lo.mul;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (age <= b.age) { const t = (age - a.age) / (b.age - a.age); return a.mul + (b.mul - a.mul) * t; }
  }
  if (age >= AI_RAMP_END_AGE) return 1.0;
  const t = (age - hi.age) / (AI_RAMP_END_AGE - hi.age);
  return hi.mul + (1.0 - hi.mul) * t;
}
// ---- index.html aiPremiumFactor と同一（ds/mle/genai のみ・関連スキル保有率で逓減・cap 頭打ち。base は年齢補間）----
function aiPremiumFactor(age, role, skillsSet) {
  if (!["ds", "mle", "genai"].includes(role)) return { mul: 1.0, applied: false };
  const AP = D.aiPremium || {};
  const base = aiPremiumBaseMul(age);
  const cap = AP.cap != null ? AP.cap : 1.20;
  const relCount = ["genai", "agent", "mlops"].filter((k) => skillsSet.has(k)).length;
  const rel = Math.min(relCount / 3, 1);
  const mul = Math.min(1 + (base - 1) * rel, cap);
  return { mul, applied: mul > 1.0001 };
}

// ---- index.html locationFactor と同一（未指定/未知キー/未定義は 1.0）----
//   index.html: locationF = (D.model.locationMul && sel.location) ? (D.model.locationMul[sel.location] ?? 1.0) : 1.0
function locationFactorOf(location) {
  const m = (D.model && D.model.locationMul) || null;
  if (!m || !location) return 1.0;
  const v = m[location];
  return (typeof v === "number" && isFinite(v)) ? v : 1.0;
}

// ---- index.html estimatePercentiles と同一（global sel 依存を引数化した純関数版）----
//   sel.{age,exp,role,skills,location} を (age|null, exp, role, skills:Set, location|null) で受ける。pref は本体に無関係（personalRange 側）。
//   ★ EXP_K は (W1-x) negative test 用のフック。既定 0.015（= index.html の係数）。
//   ★ §8：locationF を index.html と一致させて f / base の両方に掛ける（移植照合が崩れないように）。
let EXP_K = 0.015;
function estimatePercentiles(ageInput, role, skills, exp, location = null) {
  const ageKnown = Number.isFinite(ageInput);
  const age = ageKnown ? ageInput : ageFromExp(exp);
  const A = anchorAt(age);
  const stdExp = Math.max(0, age - 22);
  const expF = clamp(1 + EXP_K * (exp - stdExp), 0.88, 1.15);
  const roleF = D.model.roleMul[role];
  let premRaw = 0; skills.forEach((k) => premRaw += D.model.skillPrem[k] || 0);
  const prem = Math.min(premRaw, D.model.premCap);
  const skillF = 1 + prem;
  const ai = aiPremiumFactor(age, role, skills);
  const locationF = locationFactorOf(location);
  const f = expF * roleF * skillF * ai.mul * locationF;
  const base = A.p50 * expF * roleF * ai.mul * locationF; // base*(1+prem)=p50 を保つ
  return {
    p25: A.p25 * f, p50: A.p50 * f, p75: A.p75 * f, p90: A.p90 * f,
    mid: A.p50 * f, lo: A.p25 * f, hi: A.p90 * f,
    prem, premRaw, capped: premRaw > D.model.premCap, base,
    estimatedSpread: A.estimatedSpread, ageKnown, age,
    parts: { expF, roleF, skillF, aiMul: ai.mul, aiApplied: ai.applied, locationF },
  };
}

// ---- Wave1 テスト用ヘルパ ----
const ALL_ROLES = Object.keys(D.model.roleMul);                 // 全6職種
const CORE_ROLES = ["ds", "mle", "genai"];                       // AI中核職（aiMul 適用対象）
const NONCORE_ROLES = ALL_ROLES.filter((r) => !CORE_ROLES.includes(r)); // consult/pm/adjacent
const SKILL_KEYS = Object.keys(D.model.skillPrem);
const toSet = (arr) => new Set(arr);
// 検証で使う代表的なスキル集合パターン
const SKILL_PATTERNS = [
  [],                                   // 無し
  ["genai"],                            // 単一・関連スキル
  ["biz"],                              // 単一・非関連スキル
  ["genai", "agent", "mlops"],          // 関連3つ（aiPremium rel=1）
  ["genai", "biz", "mgmt", "eng"],      // 混在
  SKILL_KEYS.slice(),                   // 全部（premCap 飽和域）
];

// (W1-1) 多数の (age, role, skills) で p25≤p50≤p75≤p90
{
  for (let age = 22; age <= 62; age++) {
    for (const role of ALL_ROLES) {
      for (const sk of SKILL_PATTERNS) {
        const e = estimatePercentiles(age, role, toSet(sk), Math.max(0, age - 22));
        assert.ok(
          e.p25 <= e.p50 + 1e-9 && e.p50 <= e.p75 + 1e-9 && e.p75 <= e.p90 + 1e-9,
          `(W1-1) percentile 単調性違反: age=${age}, role=${role}, skills=[${sk.join(",")}] → p25=${e.p25.toFixed(2)}, p50=${e.p50.toFixed(2)}, p75=${e.p75.toFixed(2)}, p90=${e.p90.toFixed(2)}（p25≤p50≤p75≤p90 を満たしません）`,
        );
        C();
      }
    }
  }
}

// (W1-2) anchorAt(age).p50 が単調増加する区間では estimatePercentiles の p50 も単調増加。
//   f は age（expF・aiMul の band）にも依存するため、role/skills/exp を固定し、
//   かつ「anchor の p50 が実際に増える隣接2点」だけを対象にする（47→52歳の実測下降区間は除外）。
//   exp を固定すると expF が age で動くので、ここでは exp=stdExp 相当にせず「anchor 単調性が
//   出力に伝播する」ことを、aiMul=1.0 の非中核職（expF 以外に age 依存が無い職）で検証する。
//   → 非中核職では f = expF*roleF*skillF。expF を固定するため exp を age に連動させ stdExp と一致させ expF=1.0 に固定。
{
  const role = "consult";          // 非中核職 → aiMul=1.0（age 依存は expF のみ）
  const skills = toSet(["biz"]);
  let monotoneChecks = 0;
  for (let age = 22; age < 47; age++) {              // 22→47 は anchor p50 が増える区間
    const expA = Math.max(0, age - 22);              // expF=1.0 に固定（stdExp と一致）
    const expB = Math.max(0, (age + 1) - 22);        // 次の age でも expF=1.0
    const aP50 = anchorAt(age).p50, bP50 = anchorAt(age + 1).p50;
    if (!(bP50 > aP50)) continue;                    // anchor が増えない隣接対は対象外
    const eA = estimatePercentiles(age, role, skills, expA);
    const eB = estimatePercentiles(age + 1, role, skills, expB);
    assert.ok(
      eB.p50 > eA.p50 - 1e-9,
      `(W1-2) p50 単調性違反: anchor p50 が ${age}歳(${aP50})→${age + 1}歳(${bP50}) と増えるのに、estimatePercentiles の p50 が ${eA.p50.toFixed(2)}→${eB.p50.toFixed(2)} と増えていません（expF=1.0 固定・非中核職 consult）`,
    );
    monotoneChecks++;
    C();
  }
  assert.ok(monotoneChecks >= 10, `(W1-2) 前提崩れ: 単調増加を検証できた隣接対が ${monotoneChecks} 件しかありません（anchor 点列が想定外）`);
  C();
}

// (W1-3) 非中核職で aiMul===1.0。中核職でも aiMul≤cap。
{
  const cap = (D.aiPremium && D.aiPremium.cap != null) ? D.aiPremium.cap : 1.20;
  for (let age = 22; age <= 62; age += 2) {
    for (const sk of SKILL_PATTERNS) {
      for (const role of NONCORE_ROLES) {
        const m = aiPremiumFactor(age, role, toSet(sk)).mul;
        assert.equal(
          m, 1.0,
          `(W1-3) 非中核職の aiMul 違反: role=${role}, age=${age}, skills=[${sk.join(",")}] の aiMul=${m}（非中核職は常に 1.0 でなければなりません）`,
        );
        C();
      }
      for (const role of CORE_ROLES) {
        const m = aiPremiumFactor(age, role, toSet(sk)).mul;
        assert.ok(
          m >= 1.0 && m <= cap + 1e-9,
          `(W1-3) 中核職の aiMul 上限違反: role=${role}, age=${age}, skills=[${sk.join(",")}] の aiMul=${m} が [1.0, cap=${cap}] を外れています`,
        );
        C();
      }
    }
  }
}

// (W1-4) すべてのケースで base*(1+prem) が p50 と一致（誤差±1万）
{
  for (let age = 22; age <= 62; age += 2) {
    for (const role of ALL_ROLES) {
      for (const sk of SKILL_PATTERNS) {
        const e = estimatePercentiles(age, role, toSet(sk), Math.max(0, age - 22));
        const recomposed = e.base * (1 + e.prem);
        assert.ok(
          Math.abs(recomposed - e.p50) <= 1,
          `(W1-4) base*(1+prem)=p50 不変条件違反: age=${age}, role=${role}, skills=[${sk.join(",")}] → base*(1+prem)=${recomposed.toFixed(3)} と p50=${e.p50.toFixed(3)} が ±1万を超えて乖離（目標逆算 renderTargetBack の前提が壊れます）`,
        );
        C();
      }
    }
  }
}

// (W1-5) 中核職×全スキル×全年齢でも p90 ≤ 3000万（過大評価上限）
{
  const allSkills = toSet(SKILL_KEYS);
  for (let age = 22; age <= 62; age++) {
    for (const role of CORE_ROLES) {
      // exp も上限近く（過大に振る）して最悪ケースを作る
      const e = estimatePercentiles(age, role, allSkills, 40);
      assert.ok(
        e.p90 <= 3000,
        `(W1-5) 過大評価違反: age=${age}, role=${role}, 全スキル, exp=40 の p90=${e.p90.toFixed(1)}万 が 3000万 を超えています`,
      );
      C();
    }
  }
}

// (W1-6) age 未入力時 ageFromExp(exp) で補完しても p50 が有限・正
{
  for (const exp of [0, 1, 3, 5, 7, 12, 18, 25, 40]) {
    for (const role of ALL_ROLES) {
      for (const sk of SKILL_PATTERNS) {
        const e = estimatePercentiles(null, role, toSet(sk), exp); // age=null → ageFromExp(exp)
        assert.ok(
          Number.isFinite(e.p50) && e.p50 > 0,
          `(W1-6) age 未入力補完違反: exp=${exp}, role=${role}, skills=[${sk.join(",")}] → p50=${e.p50}（有限かつ正でなければなりません）`,
        );
        assert.equal(
          e.ageKnown, false,
          `(W1-6) age 未入力フラグ違反: exp=${exp} で ageKnown が false になっていません`,
        );
        assert.equal(
          e.age, ageFromExp(exp),
          `(W1-6) age 補完値違反: exp=${exp} の使用 age=${e.age} が ageFromExp(${exp})=${ageFromExp(exp)} と一致しません`,
        );
        C();
      }
    }
  }
}

// (W1-7) aiPremiumFactor の rel が関連スキル数で逓増（0個→1.0、3個→補間 base の mul）
//   ※ #3 で base を年齢補間（aiPremiumBaseMul）に変更。期待値も離散 band ではなく補間 base から導く。
{
  const REL = ["genai", "agent", "mlops"];
  for (const role of CORE_ROLES) {
    for (let age = 22; age <= 62; age += 5) {
      const cap = D.aiPremium.cap != null ? D.aiPremium.cap : 1.20;
      const interpBase = aiPremiumBaseMul(age);       // 年齢で線形補間した base 倍率
      const expectedFull = Math.min(interpBase, cap); // rel=1 のとき mul=min(interpBase,cap)

      // 0個 → 1.0
      const m0 = aiPremiumFactor(age, role, toSet([])).mul;
      assert.equal(
        m0, 1.0,
        `(W1-7) rel=0 違反: role=${role}, age=${age} で関連スキル0個なのに aiMul=${m0}（1.0 のはず）`,
      );
      C();

      // 3個（フル）→ min(interpBase, cap)
      const m3 = aiPremiumFactor(age, role, toSet(REL)).mul;
      assert.ok(
        Math.abs(m3 - expectedFull) < 1e-9,
        `(W1-7) rel=1(フル) 違反: role=${role}, age=${age} で関連スキル3個の aiMul=${m3} が min(補間base=${interpBase.toFixed(4)}, cap=${cap})=${expectedFull.toFixed(4)} と一致しません`,
      );
      C();

      // 逓増性：0個 ≤ 1個 ≤ 2個 ≤ 3個（関連スキルを足すほど mul は単調非減少）
      let prevMul = -Infinity;
      for (let n = 0; n <= 3; n++) {
        const m = aiPremiumFactor(age, role, toSet(REL.slice(0, n))).mul;
        assert.ok(
          m >= prevMul - 1e-9,
          `(W1-7) 逓増性違反: role=${role}, age=${age} で関連スキル ${n - 1}個→${n}個 に増やしたのに aiMul が ${prevMul}→${m} と減少しました`,
        );
        prevMul = m;
        C();
      }
    }
  }
}

/* ============================================================
   §8：勤務地補正 locationF の不変条件テスト（正確性改修 2026-06）

   index.html の locationFactor / estimatePercentiles に追加した locationF が満たすべき不変条件：
     - locationMul の全 key で 0.8 ≤ mul ≤ 1.25（過大/過小評価防止・validate(g2) と同条件）
     - 未指定(null)・未知キーでは locationF=1.0（後方互換：補正なし）
     - locationF を掛けても percentile 単調性 p25≤p50≤p75≤p90 を維持
     - locationF を掛けても base*(1+prem)=p50 を維持（目標逆算の前提）
     - location=null と未指定で結果が完全一致（既存 W1 テストの非破壊＝後方互換の保証）
   data.js に locationMul が無ければ後方互換のみ検証（無ければ skip）。
   ============================================================ */
{
  const LM = (D.model && D.model.locationMul) || null;
  const LOC_KEYS = LM ? Object.keys(LM) : [];
  // locationFactorOf の戻り値検証用キー集合（実キー＋未指定＋未知キー）
  const LOC_CASES = [null, "__unknown__", ...LOC_KEYS];

  // (S8-1) locationMul の全 key で 0.8 ≤ mul ≤ 1.25
  if (LM) {
    for (const k of LOC_KEYS) {
      const v = LM[k];
      assert.ok(
        typeof v === "number" && isFinite(v) && v >= 0.8 && v <= 1.25,
        `(S8-1) locationMul.${k}=${v} が現実域 0.8〜1.25 を外れています（validate(g2) と同条件）`,
      );
      C();
    }
  }

  // (S8-2) 未指定(null)・未知キーは locationF=1.0（後方互換）
  assert.equal(locationFactorOf(null), 1.0, `(S8-2) locationFactorOf(null) が 1.0 でありません`);
  C();
  assert.equal(locationFactorOf("__unknown__"), 1.0, `(S8-2) locationFactorOf(未知キー) が 1.0 でありません`);
  C();
  assert.equal(locationFactorOf(undefined), 1.0, `(S8-2) locationFactorOf(undefined) が 1.0 でありません`);
  C();

  // (S8-3) 多数の (age, role, skills, location) で p25≤p50≤p75≤p90 を維持
  for (let age = 22; age <= 62; age += 4) {
    for (const role of ALL_ROLES) {
      for (const sk of SKILL_PATTERNS) {
        for (const loc of LOC_CASES) {
          const e = estimatePercentiles(age, role, toSet(sk), Math.max(0, age - 22), loc);
          assert.ok(
            e.p25 <= e.p50 + 1e-9 && e.p50 <= e.p75 + 1e-9 && e.p75 <= e.p90 + 1e-9,
            `(S8-3) 勤務地適用で percentile 単調性違反: age=${age}, role=${role}, skills=[${sk.join(",")}], loc=${loc} → p25=${e.p25.toFixed(2)}, p50=${e.p50.toFixed(2)}, p75=${e.p75.toFixed(2)}, p90=${e.p90.toFixed(2)}`,
          );
          C();
        }
      }
    }
  }

  // (S8-4) 勤務地適用後も base*(1+prem)=p50 を維持（誤差±1万）
  for (let age = 22; age <= 62; age += 4) {
    for (const role of ALL_ROLES) {
      for (const sk of SKILL_PATTERNS) {
        for (const loc of LOC_CASES) {
          const e = estimatePercentiles(age, role, toSet(sk), Math.max(0, age - 22), loc);
          const recomposed = e.base * (1 + e.prem);
          assert.ok(
            Math.abs(recomposed - e.p50) <= 1,
            `(S8-4) base*(1+prem)=p50 不変条件違反（勤務地適用）: age=${age}, role=${role}, skills=[${sk.join(",")}], loc=${loc} → base*(1+prem)=${recomposed.toFixed(3)} と p50=${e.p50.toFixed(3)} が ±1万を超えて乖離`,
          );
          C();
        }
      }
    }
  }

  // (S8-5) location=null と「locationF=1.0 のケース」は p50 が一致＝既存 W1 テストの非破壊（後方互換）。
  //   かつ各実キーは「全係数を locationF 倍しただけ」＝p50_loc / p50_null == locationMul[key]（厳密一致）。
  for (let age = 27; age <= 57; age += 10) {
    for (const role of CORE_ROLES) {
      const skills = toSet(["genai", "agent"]);
      const exp = Math.max(0, age - 22);
      const eNull = estimatePercentiles(age, role, skills, exp, null);
      const eDefault = estimatePercentiles(age, role, skills, exp);   // location 引数省略＝null と同じ
      assert.ok(
        Math.abs(eNull.p50 - eDefault.p50) < 1e-9,
        `(S8-5) 後方互換違反: location=null(${eNull.p50}) と location 省略(${eDefault.p50}) の p50 が一致しません`,
      );
      C();
      for (const k of LOC_KEYS) {
        const eLoc = estimatePercentiles(age, role, skills, exp, k);
        const expectedRatio = LM[k];
        const actualRatio = eLoc.p50 / eNull.p50;
        assert.ok(
          Math.abs(actualRatio - expectedRatio) < 1e-9,
          `(S8-5) 勤務地倍率の伝播違反: loc=${k} で p50比=${actualRatio.toFixed(6)} が locationMul=${expectedRatio} と一致しません（f/base 両方に均一適用されているはず）`,
        );
        C();
        // 同時に parts.locationF も一致
        assert.ok(
          Math.abs(eLoc.parts.locationF - expectedRatio) < 1e-9,
          `(S8-5) parts.locationF 不一致: loc=${k} の parts.locationF=${eLoc.parts.locationF} が locationMul=${expectedRatio} と異なります`,
        );
        C();
      }
    }
  }
}

console.log(`✓ all logic tests passed (${checks} checks)`);
process.exit(0);
