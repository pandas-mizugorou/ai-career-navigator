/* ============================================================
   AI/データサイエンス転職ナビ — Service Worker
   完全クライアントサイド・外部送信ゼロ・ビルド不要。

   役割：
   - install で中核アセットを cache-first プリキャッシュ（オフライン起動を可能に）
   - fetch で HTML/data.js/ナビゲーションは network-first（最新優先・オフライン時のみキャッシュ）、
     その他（manifest・アイコン等）は cache-first（オフライン耐性）
   - activate で旧 CACHE を purge（古いデータの残留を防ぐ）

   CACHE 名は data.js の last_updated 由来（例 acn-2026-06-02）にする。
   月次でデータを更新して last_updated が変われば CACHE 名も変わり、
   新キャッシュへ自動切替＋旧版 purge が起きる（sw.js 自体の編集は不要）。
   data.js を取得できない不測時は固定フォールバック名を使う。
   ============================================================ */

const CACHE_PREFIX = "acn-";
const FALLBACK_VERSION = "fallback";
const PRECACHE = ["./", "./index.html", "./data.js", "./manifest.json"];

// data.js から meta.last_updated を抜き出して CACHE 名を決める。
// data.js は window.SALARY_DATA への代入なので、正規表現で日付だけ拾う（評価はしない＝安全）。
async function resolveCacheName() {
  try {
    const res = await fetch("./data.js", { cache: "no-store" });
    const text = await res.text();
    const m = text.match(/last_updated\s*:\s*["'](\d{4}-\d{2}-\d{2})["']/);
    if (m) return CACHE_PREFIX + m[1];
  } catch (e) { /* 取得失敗時はフォールバック */ }
  return CACHE_PREFIX + FALLBACK_VERSION;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cacheName = await resolveCacheName();
      const cache = await caches.open(cacheName);
      // addAll は1つでも失敗すると全体が reject されるため、個別に握りつぶして堅牢化。
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "no-store" })).catch(() => {})
        )
      );
      // 新版を即時有効化（待機をスキップ→activate→controllerchange→reload の連鎖。
      // 現状 skipWaiting 未呼出が「ハードリロードしないと反映されない」一因だった）。
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const current = await resolveCacheName();
      const keys = await caches.keys();
      // 自分が管理する acn-* のうち、現行以外を purge（旧月次データの残留を防ぐ）。
      await Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== current)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// 取得成功した同一オリジンの基本リソースを現行キャッシュへ追記（次回オフライン用）。
function putInCache(req, res) {
  if (res && res.ok && res.type === "basic") {
    const copy = res.clone();
    resolveCacheName().then((name) =>
      caches.open(name).then((c) => c.put(req, copy)).catch(() => {})
    );
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // GET 以外・別オリジンは素通し（このツールは同一オリジンの静的資産のみ扱う）。
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML / data.js / sw.js / ナビゲーション要求は network-first（古い年収が固定される事故を防ぐ）。
  // それ以外（manifest・data:アイコン等）は cache-first（オフライン耐性）。
  const p = url.pathname;
  const networkFirst =
    req.mode === "navigate" ||
    p.endsWith("/") ||
    p.endsWith("/index.html") ||
    p.endsWith("/data.js") ||
    p.endsWith("/sw.js");

  if (networkFirst) {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => putInCache(req, res))
        .catch(() =>
          // オフライン時のみキャッシュにフォールバック（無ければ navigate は index.html 殻）。
          caches.match(req).then((cached) =>
            cached || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())
          )
        )
    );
    return;
  }

  // cache-first：その他の同一オリジン資産。
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => putInCache(req, res))
        .catch(() =>
          req.mode === "navigate" ? caches.match("./index.html") : Response.error()
        );
    })
  );
});

// index.html のトーストから「今すぐ更新」を押したときに即時切替できるように。
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
