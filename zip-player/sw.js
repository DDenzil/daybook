/* Zip Player service worker.
   Serves the unzipped project files (stored in Cache Storage by the page) under ./run/<id>/...
   so a project's relative links, script modules, fetch() calls and models all resolve. */
const FILES = 'zip-player-files';
const SHELL = 'zip-player-shell-v1';
const SCOPE = new URL('./', self.registration.scope);
const RUN = new URL('run/', SCOPE).pathname;
const SHELL_FILES = ['./', 'index.html', 'player.js', 'player.css', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zip-player-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Must match fileKey() in player.js
const fileKey = (id, path) => new URL(`run/${id}/@/${encodeURIComponent(path)}`, SCOPE).href;

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  if (url.pathname.startsWith(RUN)) { e.respondWith(serveProjectFile(url)); return; }
  if (url.pathname.startsWith(SCOPE.pathname)) {
    // The player itself: network first, cached copy when offline
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  }
});

async function serveProjectFile(url) {
  const rest = url.pathname.slice(RUN.length);            // "<id>/<path...>"
  const slash = rest.indexOf('/');
  if (slash < 0) return Response.redirect(url.href + '/', 302);
  const id = rest.slice(0, slash);
  let path;
  try { path = decodeURIComponent(rest.slice(slash + 1)); } catch { path = rest.slice(slash + 1); }
  const cache = await caches.open(FILES);
  const tryPath = async (p) => cache.match(fileKey(id, p));
  let res = await tryPath(path);
  if (!res && (path === '' || path.endsWith('/'))) res = await tryPath(path + 'index.html');
  if (!res && !/\.[A-Za-z0-9]{1,8}$/.test(path)) {
    // "folder" without a trailing slash: send the browser to the slash version so relative links work
    if (await tryPath(path + '/index.html')) return Response.redirect(url.origin + url.pathname + '/' + url.search, 302);
  }
  if (res) return res;
  return new Response(`Not found in this project: ${path || '/'}`, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
