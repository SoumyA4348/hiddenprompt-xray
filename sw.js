// Keeps the ~30 MB engine on the device so repeat visits start without downloading it again, and lets the
// app work offline. Bump VERSION whenever anything in vendor/ changes.
const VERSION = "xray-v1";
const WHEEL = "pymupdf_lite-2.1-cp313-abi3-pyemscripten_2025_0_wasm32.whl";

const ENGINE = [
  "vendor/pyodide/pyodide.mjs",
  "vendor/pyodide/pyodide.asm.js",
  "vendor/pyodide/pyodide.asm.wasm",
  "vendor/pyodide/python_stdlib.zip",
  "vendor/pyodide/pyodide-lock.json",
  `vendor/${WHEEL}`,
  "vendor/fonts/fonts.css",
  "vendor/fonts/Figtree-400-700.woff2",
  "vendor/fonts/IBMPlexMono-400.woff2",
  "vendor/fonts/IBMPlexMono-500.woff2",
  "vendor/fonts/PixelifySans-600.woff2",
];
const SHELL = [
  "./",
  "app.js",
  "styles.css",
  "worker.js",
  "favicon.svg",
  "py/hiddenprompt_scan.py",
  "py/xray.py",
  "sample/sample-submission.pdf",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll([...ENGINE, ...SHELL])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("xray-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  e.respondWith(url.pathname.startsWith(`${scope.pathname}vendor/`) ? cacheFirst(req) : networkFirst(req));
});

// Engine files only change with VERSION, so the cached copy is always right.
async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// App files are small: always try for the latest, fall back to the cached copy offline.
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === "navigate" && await cache.match("./"));
    if (hit) return hit;
    throw err;
  }
}
