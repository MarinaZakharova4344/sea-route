/*
 * Service worker «Морского маршрута».
 *
 * Что делает:
 *  - страницы руководителя и менеджера: сначала сеть; если связи нет, показывает последнюю загруженную копию
 *    (читать последние данные можно, менять нельзя);
 *  - статика (_next/static, иконки): из кэша, так приложение быстро открывается;
 *  - запросы к API и любые изменения (не GET) никогда не кэшируются и не откладываются:
 *    данные для правок должны быть свежими, а офлайн-правок в этой версии нет;
 *  - при выходе из системы сохранённые страницы удаляются.
 */
const VERSION = "v1";
const STATIC = `sr-static-${VERSION}`;
const PAGES = `sr-pages-${VERSION}`;
const OFFLINE_URL = "/offline";
const NETWORK_TIMEOUT_MS = 8000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_PAGES") {
    event.waitUntil(caches.delete(PAGES));
  }
});

function isPrivatePage(url) {
  return url.pathname.startsWith("/director") || url.pathname.startsWith("/manager");
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: STATIC });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(STATIC).then((cache) => cache.put(request, copy));
  }
  return response;
}

function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS);
    fetch(request).then(
      (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function networkFirstPage(request, isNavigation) {
  const url = new URL(request.url);
  try {
    const response = await fetchWithTimeout(request);
    // кэшируем только обычные успешные ответы (не перенаправление на вход, не ошибки)
    if (response.ok && !response.redirected && isPrivatePage(url)) {
      const copy = response.clone();
      caches.open(PAGES).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { cacheName: PAGES, ignoreVary: true });
    if (cached) return cached;
    if (isNavigation) {
      const offline = await caches.match(OFFLINE_URL, { cacheName: STATIC });
      if (offline) return offline;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  const isNavigation = request.mode === "navigate";
  const isRsc = request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  if ((isNavigation || isRsc) && isPrivatePage(url)) {
    event.respondWith(networkFirstPage(request, isNavigation));
    return;
  }
  if (isNavigation) {
    // страница входа и прочее: сеть, а без связи страница «Нет связи»
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL, { cacheName: STATIC }).then((r) => r || Response.error())),
    );
  }
});
