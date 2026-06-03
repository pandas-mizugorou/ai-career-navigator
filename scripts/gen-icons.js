/**
 * アプリアイコン生成スクリプト
 * 採用デザイン: ナビピン × ¥（ブランドのシグネチャーグラデ 青#5b8cff→エメラルド#37e0a0）
 * 「転職ナビ（導く＝地図ピン）」×「年収（¥）」をひと目で。
 *
 * manifest.json（192/512/maskable）と index.html（favicon/apple-touch-icon）へ
 * inline data-URI で書き込む。inline 方式は既存アーキテクチャ（SW キャッシュ）に合わせたもの。
 *
 * 使い方: node scripts/gen-icons.js
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// --- パーツ定義 ---------------------------------------------------------
const GRAD =
  '<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="120" y1="430" x2="400" y2="96">' +
  '<stop offset="0" stop-color="#4d7cff"/>' +
  '<stop offset=".5" stop-color="#33b1cf"/>' +
  '<stop offset="1" stop-color="#37e0a0"/>' +
  '</linearGradient>';

// 上部のわずかな発光（奥行き）
const GLOW =
  '<radialGradient id="h" cx=".5" cy=".14" r=".95">' +
  '<stop offset="0" stop-color="#26396f"/>' +
  '<stop offset=".62" stop-color="#0b1020" stop-opacity="0"/>' +
  '</radialGradient>';

// ナビピン本体 + 内側くり抜き + ¥（プレビューで検証済みの座標をそのまま使用）
const PIN =
  '<path d="M256 454 C170 338 122 288 122 210 a134 134 0 1 1 268 0 C390 288 342 338 256 454 Z" fill="url(#g)"/>' +
  '<circle cx="256" cy="208" r="90" fill="#0b1020"/>' +
  '<text x="256" y="257" font-size="150" font-weight="800" text-anchor="middle" fill="url(#g)" ' +
  'font-family="system-ui,-apple-system,\'Segoe UI\',sans-serif">¥</text>';

const DEFS = '<defs>' + GRAD + GLOW + '</defs>';

// --- 3 バリアント -------------------------------------------------------
// any: 角丸スクエア（favicon / desktop PWA / manifest any）
const svgAny =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' + DEFS +
  '<rect width="512" height="512" rx="115" fill="#0b1020"/>' +
  '<rect width="512" height="512" rx="115" fill="url(#h)"/>' +
  PIN + '</svg>';

// apple-touch: フルスクエア（iOS が独自に角丸マスクするため透明部分を作らない）
const svgApple =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' + DEFS +
  '<rect width="512" height="512" fill="#0b1020"/>' +
  '<rect width="512" height="512" fill="url(#h)"/>' +
  PIN + '</svg>';

// maskable: フルブリード + セーフゾーン内に 82% 縮小（Android が円などで切り抜く想定）
const svgMaskable =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' + DEFS +
  '<rect width="512" height="512" fill="#0b1020"/>' +
  '<rect width="512" height="512" fill="url(#h)"/>' +
  '<g transform="translate(256 256) scale(.82) translate(-256 -256)">' + PIN + '</g></svg>';

const uri = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);

// --- manifest.json 更新 -------------------------------------------------
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.icons = [
  { src: uri(svgAny),      sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
  { src: uri(svgAny),      sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
  { src: uri(svgMaskable), sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('✓ manifest.json updated');

// --- index.html 更新（favicon / apple-touch-icon の href のみ差し替え） ----
const htmlPath = path.join(root, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const before = html;
html = html.replace(
  /<link rel="icon"[^>]*>/,
  '<link rel="icon" href="' + uri(svgAny) + '">'
);
html = html.replace(
  /<link rel="apple-touch-icon"[^>]*>/,
  '<link rel="apple-touch-icon" href="' + uri(svgApple) + '">'
);
if (html === before) {
  console.error('✗ index.html: link タグが見つからず未変更。手動確認が必要');
  process.exit(1);
}
fs.writeFileSync(htmlPath, html);
console.log('✓ index.html updated (favicon + apple-touch-icon)');

// --- 参照用にソース SVG も保存 ------------------------------------------
fs.writeFileSync(path.join(__dirname, 'icon-any.svg'), svgAny);
fs.writeFileSync(path.join(__dirname, 'icon-maskable.svg'), svgMaskable);
console.log('✓ source SVGs written to scripts/');
console.log('  any data-URI length:', uri(svgAny).length);
