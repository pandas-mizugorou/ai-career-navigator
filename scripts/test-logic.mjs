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

console.log(`✓ all logic tests passed (${checks} checks)`);
process.exit(0);
