/* Zip Player: unzip an HTML project on the device and play it.
   Files go into Cache Storage; sw.js serves them under ./run/<id>/ so relative links,
   script modules, fetch(), WebAssembly and 3D models load as if from a web server. */
'use strict';
(() => {
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FILES = 'zip-player-files';
const LIB_KEY = 'zipplayer.library';
const SCOPE = new URL('./', location.href);
const fileKey = (id, path) => new URL(`run/${id}/@/${encodeURIComponent(path)}`, SCOPE).href; // same as sw.js
const runUrl = (id, path) => new URL(`run/${id}/` + path.split('/').map(encodeURIComponent).join('/'), SCOPE).href;
const LIMITS = { entries: 20000, total: 1.5e9, file: 300e6 };

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', xhtml: 'application/xhtml+xml',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', cjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  md: 'text/plain; charset=utf-8', xml: 'application/xml', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', bmp: 'image/bmp', ktx2: 'image/ktx2', hdr: 'application/octet-stream', exr: 'application/octet-stream',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', obj: 'text/plain', fbx: 'application/octet-stream',
  wasm: 'application/wasm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', vtt: 'text/vtt',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf',
};
const mimeOf = (p) => MIME[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

/* ---------- UI helpers ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
function showError(msg) { const e = $('#error'); e.textContent = msg; e.hidden = !msg; }
function progress(label, frac) {
  const p = $('#progress');
  if (label == null) { p.hidden = true; return; }
  p.hidden = false; $('#progress-label').textContent = label;
  $('#progress-pct').textContent = frac == null ? '' : Math.round(frac * 100) + '%';
  $('#progress-bar').style.width = (frac == null ? 0 : frac * 100) + '%';
}
const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

/* ---------- library (list of unpacked projects) ---------- */
const lib = {
  get() { try { return JSON.parse(localStorage.getItem(LIB_KEY)) || []; } catch { return []; } },
  set(v) { try { localStorage.setItem(LIB_KEY, JSON.stringify(v)); } catch {} },
};
function renderLibrary() {
  const items = lib.get().sort((a, b) => b.added - a.added);
  $('#library').innerHTML = items.map((p) => `
    <div class="item">
      <div class="info"><div class="name">${esc(p.name)}</div>
        <div class="meta">${p.files} files · ${fmtSize(p.size)} · ${new Date(p.added).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}${p.entry !== 'index.html' ? ' · ' + esc(p.entry) : ''}</div></div>
      <button class="play" type="button" data-play="${esc(p.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>Play</button>
      <button class="icon-btn" type="button" data-del="${esc(p.id)}" aria-label="Remove ${esc(p.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>
    </div>`).join('');
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((e) => { $('#usage').textContent = e.usage ? fmtSize(e.usage) + ' used' : ''; }).catch(() => {});
  }
}
async function removeProject(id) {
  const cache = await caches.open(FILES);
  const prefix = new URL(`run/${id}/`, SCOPE).href;
  const keys = await cache.keys();
  await Promise.all(keys.filter((r) => r.url.startsWith(prefix)).map((r) => cache.delete(r)));
  lib.set(lib.get().filter((p) => p.id !== id));
}

/* ---------- ZIP reading (no library: uses the browser's built-in deflate) ---------- */
const u16 = (v, o) => v.getUint16(o, true), u32 = (v, o) => v.getUint32(o, true);
const u64 = (v, o) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 4294967296;
function readZipDir(buf) {
  const v = new DataView(buf), n = buf.byteLength;
  let eo = -1;
  for (let i = n - 22; i >= Math.max(0, n - 65557); i--) if (u32(v, i) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error('This is not a ZIP file, or it is damaged.');
  let count = u16(v, eo + 10), cd = u32(v, eo + 16);
  if ((count === 0xFFFF || cd === 0xFFFFFFFF) && eo >= 20 && u32(v, eo - 20) === 0x07064b50) {
    const z = u64(v, eo - 12);
    if (z + 56 <= n && u32(v, z) === 0x06064b50) { count = u64(v, z + 32); cd = u64(v, z + 48); }
  }
  const utf8 = new TextDecoder('utf-8'), cp437 = new TextDecoder('ibm866');
  const out = [];
  for (let k = 0, p = cd; k < count && p + 46 <= n; k++) {
    if (u32(v, p) !== 0x02014b50) break;
    const flags = u16(v, p + 8), method = u16(v, p + 10), nl = u16(v, p + 28), el = u16(v, p + 30), cl = u16(v, p + 32);
    let csize = u32(v, p + 20), usize = u32(v, p + 24), lo = u32(v, p + 42);
    const raw = new Uint8Array(buf, p + 46, Math.min(nl, n - p - 46));
    let name;
    if (flags & 0x800) name = utf8.decode(raw);
    else { try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { name = cp437.decode(raw); } }
    for (let e = p + 46 + nl, ee = Math.min(e + el, n); e + 4 <= ee;) {
      const id = u16(v, e), sz = u16(v, e + 2);
      if (id === 1) { let q = e + 4; if (usize === 0xFFFFFFFF) { usize = u64(v, q); q += 8; } if (csize === 0xFFFFFFFF) { csize = u64(v, q); q += 8; } if (lo === 0xFFFFFFFF) lo = u64(v, q); }
      e += 4 + sz;
    }
    out.push({ name: name.replace(/\\/g, '/'), flags, method, csize, usize, lo });
    p += 46 + nl + el + cl;
  }
  return out;
}
async function entryBytes(buf, en) {
  const v = new DataView(buf);
  if (en.lo + 30 > buf.byteLength || u32(v, en.lo) !== 0x04034b50) throw new Error('damaged entry');
  const start = en.lo + 30 + u16(v, en.lo + 26) + u16(v, en.lo + 28);
  const data = new Uint8Array(buf, start, Math.max(0, Math.min(en.csize, buf.byteLength - start)));
  if (en.method === 0) return data;
  if (en.method !== 8) throw new Error('uses a compression type this player cannot unpack');
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unpack ZIPs (update iOS / your browser)');
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}

/* ---------- open a ZIP ---------- */
async function openZip(file) {
  showError(''); $('#entry-pick').hidden = true;
  if (!file) return;
  if (!/\.zip$/i.test(file.name) && !/zip/.test(file.type)) { showError('Choose a .zip file.'); return; }
  await swReady;
  progress('Reading ' + file.name, 0);
  let buf;
  try { buf = await file.arrayBuffer(); } catch { progress(null); showError('Could not read that file.'); return; }

  let entries;
  try { entries = readZipDir(buf); } catch (e) { progress(null); showError(e.message); return; }
  const files = entries.filter((en) => !en.name.endsWith('/') && !/(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/i.test(en.name))
    .filter((en) => !/(^|\/)\.\.(\/|$)/.test(en.name) && !/^\//.test(en.name) && !/^[a-z]:/i.test(en.name));
  if (!files.length) { progress(null); showError('The ZIP is empty.'); return; }
  if (files.length > LIMITS.entries) { progress(null); showError('That ZIP has too many files (over 20,000).'); return; }
  if (files.some((f) => f.flags & 1)) { progress(null); showError('That ZIP is password-protected. Zip it again without a password.'); return; }
  if (files.reduce((a, f) => a + f.usize, 0) > LIMITS.total) { progress(null); showError('That ZIP unpacks to more than 1.5 GB.'); return; }

  // Find the page to play: the shallowest index.html; its folder becomes the site root
  const indexes = files.map((f) => f.name).filter((n) => /(^|\/)index\.html?$/i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  let root = '', entry = null;
  if (indexes.length) { entry = indexes[0]; root = entry.slice(0, entry.lastIndexOf('/') + 1); }
  else {
    // otherwise a single top folder (if any) is the root, and the user picks a page
    const tops = new Set(files.map((f) => f.name.split('/')[0]));
    if (tops.size === 1 && files.every((f) => f.name.includes('/'))) root = [...tops][0] + '/';
  }
  const inRoot = files.filter((f) => f.name.startsWith(root));
  const htmlPages = inRoot.map((f) => f.name.slice(root.length)).filter((n) => /\.html?$/i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  if (!entry && !htmlPages.length) { progress(null); showError('No HTML page was found in that ZIP.'); return; }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const cache = await caches.open(FILES);
  let done = 0, size = 0;
  const failed = [];
  try {
    for (const f of inRoot) {
      const path = f.name.slice(root.length);
      if (f.usize > LIMITS.file) { failed.push(path + ' (too large)'); continue; }
      try {
        const bytes = await entryBytes(buf, f);
        await cache.put(fileKey(id, path), new Response(bytes, { headers: { 'Content-Type': mimeOf(path), 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'no-cache' } }));
        size += bytes.byteLength;
      } catch (e) { failed.push(path + ' (' + e.message + ')'); }
      if (++done % 5 === 0 || done === inRoot.length) progress('Unpacking ' + file.name, done / inRoot.length);
    }
  } catch (e) {
    progress(null);
    await removeProject(id);
    showError(/quota/i.test(e.name + e.message) ? 'Not enough storage on this device. Remove some projects and try again.' : 'Could not unpack: ' + e.message);
    return;
  }
  progress(null);
  buf = null;

  const name = file.name.replace(/\.zip$/i, '');
  const addToLibrary = async (entryPath) => {
    // Replace an older copy of the same ZIP
    for (const old of lib.get().filter((p) => p.name === name)) await removeProject(old.id);
    lib.set([...lib.get(), { id, name, entry: entryPath, files: inRoot.length - failed.length, size, added: Date.now() }]);
    renderLibrary();
    if (failed.length) toast(`${failed.length} file${failed.length > 1 ? 's' : ''} could not be unpacked.`);
    play(id);
  };

  if (entry) { await addToLibrary(entry.slice(root.length)); return; }
  // Let the user choose which page to play
  $('#entry-list').innerHTML = htmlPages.map((p) => `<button class="entry" type="button" data-entry="${esc(p)}">${esc(p)}<span aria-hidden="true">›</span></button>`).join('');
  $('#entry-pick').hidden = false;
  $('#entry-list').onclick = (e) => {
    const b = e.target.closest('[data-entry]'); if (!b) return;
    $('#entry-pick').hidden = true; addToLibrary(b.dataset.entry);
  };
}

/* ---------- player ---------- */
function play(id) {
  const p = lib.get().find((x) => x.id === id);
  if (!p) return;
  $('#frame').src = runUrl(p.id, p.entry);
  $('#player').hidden = false;
  document.body.style.overflow = 'hidden';
  history.pushState({ playing: id }, '');   // the phone's back gesture closes the project
}
function closePlayer(fromHistory) {
  if ($('#player').hidden) return;
  $('#player').hidden = true;
  $('#frame').src = 'about:blank';
  document.body.style.overflow = '';
  if (!fromHistory && history.state && history.state.playing) history.back();
}
window.addEventListener('popstate', () => closePlayer(true));
// The close button can be dragged out of the way of the project's own controls; a tap closes.
(() => {
  const btn = $('#close'), POS = 'zipplayer.closepos';
  const place = (x, y) => {
    const m = 6, w = btn.offsetWidth || 36;
    x = Math.min(Math.max(m, x), innerWidth - w - m); y = Math.min(Math.max(m, y), innerHeight - w - m);
    Object.assign(btn.style, { left: x + 'px', top: y + 'px', right: 'auto' });
    return { x, y };
  };
  try { const s = JSON.parse(localStorage.getItem(POS)); if (s) requestAnimationFrame(() => place(s.x * innerWidth, s.y * innerHeight)); } catch {}
  let start = null, moved = false;
  btn.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, bx: btn.getBoundingClientRect().left, by: btn.getBoundingClientRect().top }; moved = false; btn.setPointerCapture(e.pointerId); });
  btn.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true; btn.classList.add('dragging');
    place(start.bx + dx, start.by + dy);
  });
  btn.addEventListener('pointerup', () => {
    if (!start) return;
    start = null; btn.classList.remove('dragging');
    if (moved) { const r = btn.getBoundingClientRect(); try { localStorage.setItem(POS, JSON.stringify({ x: r.left / innerWidth, y: r.top / innerHeight })); } catch {} }
    else closePlayer(false);
  });
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closePlayer(false); } });
})();

/* ---------- events ---------- */
$('#pick').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openZip(f); });
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => openZip(e.dataTransfer.files[0]));
$('#library').addEventListener('click', async (e) => {
  const pl = e.target.closest('[data-play]');
  if (pl) { await swReady; play(pl.dataset.play); return; }
  const del = e.target.closest('[data-del]');
  if (del) {
    const p = lib.get().find((x) => x.id === del.dataset.del);
    if (p && confirm(`Remove “${p.name}” from this device?`)) { await removeProject(p.id); renderLibrary(); toast('Removed'); }
  }
});

/* ---------- boot ---------- */
let swReady = Promise.resolve();
if (!('serviceWorker' in navigator) || !('caches' in window)) {
  showError('This browser cannot run unpacked projects. Use Safari, Chrome or Edge.');
  $('#drop').hidden = true;
} else {
  swReady = navigator.serviceWorker.register('sw.js', { scope: './' }).then(async (reg) => {
    const sw = reg.installing || reg.waiting || reg.active;
    if (sw && sw.state !== 'activated') await new Promise((res) => sw.addEventListener('statechange', () => sw.state === 'activated' && res()));
  }).catch((e) => showError('Could not start the player: ' + e.message));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
renderLibrary();
})();
