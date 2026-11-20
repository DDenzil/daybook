/* Daybook — personal projects & daily routine tracker.
   Data: CSV files in a private GitHub repo, read and written through the GitHub REST API.
   No build step, no dependencies. */
'use strict';

const VERSION = '1.2.0';
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PALETTE = ['#2563EB', '#0F766E', '#DB2777', '#EA580C', '#16A34A', '#7C3AED', '#CA8A04', '#0891B2', '#DC2626', '#64748B'];
const DEFAULT_CATS = [
  { name: 'Work', color: '#2563EB' },
  { name: 'Personal', color: '#0F766E' },
  { name: 'Family', color: '#EA580C' },
  { name: 'Friends', color: '#DB2777' },
  { name: 'Health', color: '#16A34A' },
];
const DEFAULT_SETTINGS = {
  name: '',
  timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Qatar'),
  weekend: 'Fri Sat',
  digest: '06:30',
  wrap: '21:00',
  lead: '15',
};
const FILES = {
  tasks: 'data/tasks.csv',
  categories: 'data/categories.csv',
  log: 'data/log.csv',
  settings: 'data/settings.csv',
};
const COLS = {
  tasks: ['id', 'title', 'category', 'kind', 'repeat', 'days', 'time', 'due', 'project', 'priority', 'status', 'remind', 'notes', 'created', 'done_at'],
  categories: ['name', 'color'],
  log: ['date', 'id'],
  settings: ['key', 'value'],
};
const PUSH_FILE = 'data/push.json';
const BACKEND = [['remind.yml', '.github/workflows/remind.yml'], ['remind.py', 'scripts/remind.py']];

/* ---------- icons ---------- */
const svg = (d, extra = '') => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.4"'),
  today: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  tasks: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>'),
  projects: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  review: svg('<path d="M4 20V11M10 20V5M16 20v-6M22 20H2"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  repeat: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>', 'width="13" height="13"'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
};
const NAV = [
  ['today', 'Today', ICON.today],
  ['tasks', 'Tasks', ICON.tasks],
  ['projects', 'Projects', ICON.projects],
  ['review', 'Review', ICON.review],
  ['settings', 'Settings', ICON.settings],
];

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => ymd(new Date());
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}
function fmtDate(s) {
  if (!s) return '';
  const t = new Date();
  if (s === ymd(t)) return 'Today';
  if (s === ymd(addDays(t, 1))) return 'Tomorrow';
  if (s === ymd(addDays(t, -1))) return 'Yesterday';
  const d = parseYmd(s);
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== t.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
const b64e = (s) => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(bin); };
const b64d = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uBytes = (s) => { const p = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(p + '='.repeat((4 - p.length % 4) % 4)), (c) => c.charCodeAt(0)); };

/* ---------- links in notes ---------- */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;
function linkLabel(u) {
  try { const x = new URL(u); const last = decodeURIComponent(x.pathname.split('/').filter(Boolean).pop() || ''); return last || x.hostname; }
  catch { return u; }
}
// Pages on Daybook's own site open inside the app (full screen, no browser bars); other sites open in a new tab.
const APP_SCOPE = new URL('./', location.href).href;
const linkTarget = (u) => (u.startsWith(APP_SCOPE) ? '' : ' target="_blank" rel="noopener"');
function linkify(text) {
  text = String(text || ''); let out = '', last = 0;
  text.replace(URL_RE, (m, idx) => {
    const url = m.replace(/[.,;:!?)\]]+$/, '');
    out += esc(text.slice(last, idx)) + `<a href="${esc(url)}"${linkTarget(url)}>${esc(linkLabel(url))} ↗</a>` + esc(m.slice(url.length));
    last = idx + m.length; return m;
  });
  return out + esc(text.slice(last));
}
const urlsIn = (text) => (String(text || '').match(URL_RE) || []).map((m) => m.replace(/[.,;:!?)\]]+$/, ''));

/* ---------- CSV ---------- */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const clean = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (!clean.length) return [];
  const head = clean[0].map((h) => h.trim());
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
function toCSV(cols, rows) {
  const cell = (v) => { v = String(v ?? ''); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

/* ---------- connection + GitHub API ---------- */
const Conn = {
  get() { try { return JSON.parse(localStorage.getItem('daybook.conn')); } catch { return null; } },
  set(v) { localStorage.setItem('daybook.conn', JSON.stringify(v)); },
  clear() { localStorage.removeItem('daybook.conn'); localStorage.removeItem('daybook.cache'); },
};
async function api(path, opts = {}, conn = Conn.get()) {
  return fetch(`https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}${path}`, {
    ...opts,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${conn.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}
async function ghGet(file) {
  const r = await api(`/contents/${file}?ref=${encodeURIComponent(Conn.get().branch)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} reading ${file}`);
  const j = await r.json();
  return { sha: j.sha, text: b64d(j.content || '') };
}
async function ghPut(file, text, sha, message) {
  const body = { message: message || `Daybook: update ${file}`, content: b64e(text), branch: Conn.get().branch };
  if (sha) body.sha = sha;
  const r = await api(`/contents/${file}`, { method: 'PUT', body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) { const e = new Error('conflict'); e.conflict = true; throw e; }
  if (!r.ok) { const e = new Error(`GitHub ${r.status} saving ${file}`); e.status = r.status; throw e; }
  return (await r.json()).content.sha;
}
async function ghPutSafe(file, text, message) {
  // Write a file whose sha we may not know (fetch it first, retry once on conflict).
  const cur = await ghGet(file);
  try { return await ghPut(file, text, cur?.sha, message); }
  catch (e) { if (!e.conflict) throw e; const again = await ghGet(file); return ghPut(file, text, again?.sha, message); }
}

/* ---------- state ---------- */
const S = {
  tasks: [], categories: [], log: [], settings: { ...DEFAULT_SETTINGS },
  sha: {}, dirty: new Set(),
  view: 'today', cat: 'All', kind: 'all', q: '', showDone: false, showDoneProjects: false,
  sync: 'ok', lastSync: null, push: 'unknown',
};
function persist() {
  localStorage.setItem('daybook.cache', JSON.stringify({
    tasks: S.tasks, categories: S.categories, log: S.log, settings: S.settings,
    sha: S.sha, dirty: [...S.dirty], lastSync: S.lastSync,
  }));
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem('daybook.cache'));
    if (!c) return false;
    Object.assign(S, { tasks: c.tasks || [], categories: c.categories || [], log: c.log || [], settings: { ...DEFAULT_SETTINGS, ...(c.settings || {}) }, sha: c.sha || {}, dirty: new Set(c.dirty || []), lastSync: c.lastSync || null });
    return true;
  } catch { return false; }
}
function serialize(name) {
  if (name === 'settings') return toCSV(COLS.settings, Object.entries(S.settings).map(([key, value]) => ({ key, value })));
  return toCSV(COLS[name], S[name]);
}

let flushTimer = null, flushing = false;
function save(...names) {
  names.forEach((n) => S.dirty.add(n));
  persist();
  render();
  setSync('saving');
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 1200);
}
async function flush() {
  if (flushing || !S.dirty.size) return;
  if (!navigator.onLine) { setSync('offline'); return; }
  flushing = true; setSync('saving');
  try {
    for (const n of [...S.dirty]) {
      const text = serialize(n);
      try { S.sha[n] = await ghPut(FILES[n], text, S.sha[n], `Daybook: update ${n}`); }
      catch (e) {
        if (!e.conflict) throw e;
        const cur = await ghGet(FILES[n]); // single user: last write wins
        S.sha[n] = await ghPut(FILES[n], text, cur?.sha, `Daybook: update ${n}`);
      }
      S.dirty.delete(n);
      persist();
    }
    S.lastSync = new Date().toISOString(); persist();
    setSync('ok');
  } catch (e) {
    console.error(e);
    setSync(navigator.onLine ? 'error' : 'offline');
  } finally {
    flushing = false;
    if (S.dirty.size && S.sync === 'ok') flushTimer = setTimeout(flush, 400);
  }
}
async function pull() {
  if (!navigator.onLine) { setSync('offline'); return 'offline'; }
  setSync('saving');
  const out = await Promise.all(Object.entries(FILES).map(async ([n, f]) => [n, await ghGet(f)]));
  if (out.every(([, v]) => !v)) { setSync('ok'); return 'empty'; }
  for (const [n, v] of out) {
    if (!v) { delete S.sha[n]; S.dirty.add(n); continue; }
    S.sha[n] = v.sha;
    if (S.dirty.has(n)) continue; // unsaved local edits win
    const rows = parseCSV(v.text);
    if (n === 'settings') S.settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
    else S[n] = rows;
  }
  if (!S.categories.length) { S.categories = DEFAULT_CATS.map((c) => ({ ...c })); S.dirty.add('categories'); }
  S.lastSync = new Date().toISOString();
  persist();
  setSync('ok');
  render();
  if (S.dirty.size) flush();
  return 'ok';
}
async function installBackend() {
  for (const [src, dst] of BACKEND) {
    const res = await fetch(src, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load ${src}`);
    await ghPutSafe(dst, await res.text(), 'Daybook: install reminder workflow');
  }
}

/* ---------- domain logic ---------- */
const byId = (id) => S.tasks.find((t) => t.id === id);
const catColor = (name) => (S.categories.find((c) => c.name === name)?.color) || '#8E8E93';
const weekendDays = () => (S.settings.weekend || '').split(/\s+/).filter(Boolean);
const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.title.localeCompare(b.title);
function isScheduled(t, d) {
  if (t.kind !== 'routine' || t.status === 'paused') return false;
  const ds = ymd(d);
  if (t.created && t.created > ds) return false;
  const name = DAY[d.getDay()];
  switch (t.repeat) {
    case 'weekdays': return !weekendDays().includes(name);
    case 'weekends': return weekendDays().includes(name);
    case 'custom': return (t.days || '').split(/\s+/).includes(name);
    default: return true;
  }
}
function logSet() { return new Set(S.log.map((l) => `${l.date}|${l.id}`)); }
function repeatLabel(t) {
  if (t.status === 'paused') return 'Paused';
  if (t.repeat === 'weekdays') { const wk = weekendDays(); return `Weekdays (${DAY.filter((d) => !wk.includes(d)).map((d) => d.slice(0, 2)).join(' ')})`; }
  if (t.repeat === 'weekends') return 'Weekends';
  if (t.repeat === 'custom') return (t.days || '').split(/\s+/).filter(Boolean).join(' ') || 'No days set';
  return 'Daily';
}
function projectStats(p) {
  const linked = S.tasks.filter((t) => t.kind === 'task' && t.project === p.id);
  const done = linked.filter((t) => t.status === 'done').length;
  return { linked, done, total: linked.length, pct: linked.length ? Math.round(done / linked.length * 100) : (p.status === 'done' ? 100 : 0) };
}
function streak() {
  const ls = logSet(); let n = 0;
  for (let i = 0; i < 400; i++) {
    const d = addDays(new Date(), -i), ds = ymd(d);
    const sched = S.tasks.filter((t) => isScheduled(t, d));
    if (!sched.length) { if (i > 60 && n === 0) break; continue; }
    const all = sched.every((t) => ls.has(`${ds}|${t.id}`));
    if (all) n++;
    else if (i === 0) continue; // today still in progress
    else break;
  }
  return n;
}

function toggle(id) {
  const t = byId(id); if (!t) return;
  const ds = today();
  if (t.kind === 'routine') {
    const i = S.log.findIndex((l) => l.date === ds && l.id === id);
    if (i >= 0) S.log.splice(i, 1); else S.log.push({ date: ds, id });
    save('log');
  } else {
    if (t.status === 'done') { t.status = 'open'; t.done_at = ''; } else { t.status = 'done'; t.done_at = ds; }
    save('tasks');
  }
  if (navigator.vibrate) navigator.vibrate(8);
}

/* ---------- rendering ---------- */
function setSync(state) {
  S.sync = state;
  const el = $('#syncPill'); if (!el) return;
  el.dataset.state = state;
  $('.label', el).textContent = { ok: 'Synced', saving: 'Saving…', offline: 'Offline', error: 'Retry sync' }[state] || 'Synced';
}
function itemRow(t, { done = false, idle = false, meta = [] } = {}) {
  return `<div class="item${done ? ' done' : ''}" style="--c:${esc(catColor(t.category))}">
    <button type="button" class="check${idle ? ' idle' : ''}" ${idle ? 'disabled' : `data-act="toggle" data-id="${esc(t.id)}"`} aria-pressed="${done}" aria-label="${done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}"><span class="box">${ICON.check}</span></button>
    <button type="button" class="item-body" data-act="edit" data-id="${esc(t.id)}"><span class="t">${esc(t.title)}</span>${meta.length ? `<span class="m">${meta.join('')}</span>` : ''}</button>
  </div>`;
}
const metaCat = (t) => `<i><span class="dot-c" style="--c:${esc(catColor(t.category))}"></span>${esc(t.category)}</i>`;
const metaTxt = (s, cls = '') => `<i${cls ? ` class="${cls}"` : ''}>${esc(s)}</i>`;
function taskMeta(t, { withDate = true } = {}) {
  const m = [];
  const ds = today();
  if (withDate && t.due) m.push(metaTxt(t.status !== 'done' && t.due < ds ? `Due ${fmtDate(t.due)}` : fmtDate(t.due), t.status !== 'done' && t.due < ds ? 'late' : ''));
  if (t.time) m.push(metaTxt(fmtTime(t.time)));
  m.push(metaCat(t));
  if (t.project) { const p = byId(t.project); if (p) m.push(metaTxt(p.title)); }
  if (t.priority === 'high') m.push(metaTxt('High priority', 'hi'));
  if (urlsIn(t.notes).length) m.push(metaTxt('Has link'));
  return m;
}
function routineMeta(t) {
  const m = [];
  if (t.time) m.push(metaTxt(fmtTime(t.time)));
  m.push(`<i>${ICON.repeat}${esc(repeatLabel(t))}</i>`);
  m.push(metaCat(t));
  return m;
}
function chipsHTML(extraUsed) {
  const names = S.categories.map((c) => c.name);
  const all = ['All', ...names, ...[...extraUsed].filter((n) => n && !names.includes(n))];
  return `<div class="chips" role="group" aria-label="Filter by category">${all.map((n) =>
    `<button type="button" class="chip" data-act="cat" data-cat="${esc(n)}" aria-pressed="${S.cat === n}">${n === 'All' ? '' : `<span class="dot-c" style="--c:${esc(catColor(n))}"></span>`}${esc(n)}</button>`).join('')}</div>`;
}
const catFilter = (t) => S.cat === 'All' || t.category === S.cat;
function ring(done, total) {
  const r = 30, c = 2 * Math.PI * r, pct = total ? done / total : 0;
  return `<svg class="ring" viewBox="0 0 76 76" role="img" aria-label="${done} of ${total} done">
    <circle class="track" cx="38" cy="38" r="${r}" fill="none" stroke-width="8"/>
    <circle class="bar" cx="38" cy="38" r="${r}" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 38 38)"/>
    <text x="38" y="44" text-anchor="middle">${total ? Math.round(pct * 100) : 0}%</text></svg>`;
}
function section(title, count, body) {
  return `<h2 class="section">${esc(title)}${count != null ? ` <span class="count">${count}</span>` : ''}</h2><div class="list-card"><div class="list">${body}</div></div>`;
}

function viewToday() {
  const now = new Date(), ds = ymd(now), ls = logSet();
  const h = now.getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const routines = S.tasks.filter((t) => isScheduled(t, now)).sort(byTime);
  const overdue = S.tasks.filter((t) => t.kind === 'task' && t.status !== 'done' && t.due && t.due < ds).sort((a, b) => a.due.localeCompare(b.due));
  const dueToday = S.tasks.filter((t) => t.kind === 'task' && (t.due === ds || (t.status === 'done' && t.done_at === ds && t.due && t.due < ds))).sort(byTime);
  const soon = S.tasks.filter((t) => t.kind === 'task' && t.status !== 'done' && t.due && t.due > ds && t.due <= ymd(addDays(now, 7))).sort((a, b) => a.due.localeCompare(b.due) || byTime(a, b));

  const all = [...routines, ...overdue, ...dueToday].filter(catFilter);
  const isDone = (t) => (t.kind === 'routine' ? ls.has(`${ds}|${t.id}`) : t.status === 'done');
  const done = all.filter(isDone).length;
  const hm = nowHM();
  const next = all.filter((t) => !isDone(t) && t.time && t.time >= hm).sort(byTime)[0];
  const sub = !all.length ? 'Nothing scheduled' : done === all.length ? 'All done for today' : next ? `Next: ${next.title} at ${fmtTime(next.time)}` : `${all.length - done} still open`;

  const used = new Set([...routines, ...overdue, ...dueToday, ...soon].map((t) => t.category));
  let html = `<h1 class="title">${greet}${S.settings.name ? `, ${esc(S.settings.name)}` : ''}</h1>
    <div class="card hero">${ring(done, all.length)}<div class="hero-text"><b>${done} of ${all.length} done</b><span>${esc(sub)}</span></div></div>
    ${chipsHTML(used)}`;

  const r = routines.filter(catFilter), o = overdue.filter(catFilter), d = dueToday.filter(catFilter), s = soon.filter(catFilter);
  if (o.length) html += section('Overdue', o.length, o.map((t) => itemRow(t, { meta: taskMeta(t) })).join(''));
  if (r.length) html += section('Routine', `${r.filter(isDone).length}/${r.length}`, r.map((t) => itemRow(t, { done: isDone(t), meta: routineMeta(t) })).join(''));
  if (d.length) html += section('Due today', d.length, d.map((t) => itemRow(t, { done: t.status === 'done', meta: taskMeta(t, { withDate: false }) })).join(''));
  if (s.length) html += section('Next 7 days', s.length, s.slice(0, 8).map((t) => itemRow(t, { meta: taskMeta(t) })).join(''));
  if (!o.length && !r.length && !d.length && !s.length) {
    html += `<div class="empty"><b>${S.tasks.length ? 'Clear day' : 'Welcome to Daybook'}</b>${S.tasks.length ? 'Nothing scheduled here today.' : 'Tap + to add your first routine, task or project.'}</div>`;
  }
  return html;
}

function viewTasks() {
  return `<h1 class="title">Tasks</h1>
    <div class="toolbar">
      <input class="search" id="search" type="search" placeholder="Search" value="${esc(S.q)}" aria-label="Search tasks">
      <div class="seg" role="group" aria-label="Type">
        ${[['all', 'All'], ['routine', 'Routines'], ['task', 'Tasks']].map(([k, l]) => `<button type="button" data-act="kind" data-kind="${k}" aria-pressed="${S.kind === k}">${l}</button>`).join('')}
      </div>
    </div>
    ${chipsHTML(new Set(S.tasks.map((t) => t.category)))}
    <div id="taskList">${taskListHTML()}</div>
    <div class="row-between" style="margin-top:14px"><span></span><button type="button" class="linkbtn" data-act="showDone">${S.showDone ? 'Hide completed' : 'Show completed'}</button></div>`;
}
function taskListHTML() {
  const ds = today(), ls = logSet(), q = S.q.trim().toLowerCase(), now = new Date();
  const items = S.tasks.filter((t) => t.kind !== 'project')
    .filter((t) => S.kind === 'all' || t.kind === S.kind)
    .filter(catFilter)
    .filter((t) => S.showDone || t.kind === 'routine' || t.status !== 'done')
    .filter((t) => !q || `${t.title} ${t.notes} ${t.category}`.toLowerCase().includes(q));
  if (!items.length) return `<div class="empty"><b>Nothing here</b>${q ? 'No matches for your search.' : 'Tap + to add one.'}</div>`;
  const order = [...S.categories.map((c) => c.name), ...new Set(items.map((t) => t.category))];
  const groups = [...new Set(order)].map((name) => [name, items.filter((t) => t.category === name)]).filter(([, l]) => l.length);
  const sortTask = (a, b) => (a.status === 'done') - (b.status === 'done') || (a.due || '9999').localeCompare(b.due || '9999') || byTime(a, b);
  return groups.map(([name, list]) => {
    const rs = list.filter((t) => t.kind === 'routine').sort(byTime);
    const ts = list.filter((t) => t.kind === 'task').sort(sortTask);
    const rows = [
      ...rs.map((t) => { const sched = isScheduled(t, now); return itemRow(t, { done: sched && ls.has(`${ds}|${t.id}`), idle: !sched, meta: routineMeta(t).filter((m) => !m.includes('dot-c')) }); }),
      ...ts.map((t) => itemRow(t, { done: t.status === 'done', meta: taskMeta(t).filter((m) => !m.includes('dot-c')) })),
    ];
    return `<h2 class="section"><span class="dot-c" style="--c:${esc(catColor(name))}"></span>${esc(name)} <span class="count">${list.length}</span></h2><div class="list-card"><div class="list">${rows.join('')}</div></div>`;
  }).join('');
}

function viewProjects() {
  const ds = today();
  const projects = S.tasks.filter((t) => t.kind === 'project').filter(catFilter)
    .filter((p) => S.showDoneProjects || p.status !== 'done')
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.due || '9999').localeCompare(b.due || '9999'));
  const cards = projects.map((p) => {
    const st = projectStats(p);
    const late = p.status !== 'done' && p.due && p.due < ds;
    const pill = p.status === 'done' ? '<span class="pill done">Done</span>' : late ? '<span class="pill late">Overdue</span>' : p.due ? `<span class="pill">Due ${esc(fmtDate(p.due))}</span>` : '';
    const open = st.linked.filter((t) => t.status !== 'done').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 4);
    return `<article class="card project" style="--c:${esc(catColor(p.category))}">
      <div class="p-head">
        <div><button type="button" class="p-title" data-act="edit" data-id="${esc(p.id)}"><span class="dot-c"></span>${esc(p.title)}</button>
        <div class="p-meta">${esc(p.category)}</div></div>${pill}
      </div>
      ${p.notes ? `<div class="p-notes">${linkify(p.notes)}</div>` : ''}
      <div class="progress"><div class="track"><div class="fill" style="width:${st.pct}%"></div></div><span>${st.done}/${st.total}</span></div>
      ${open.length ? `<div class="list">${open.map((t) => itemRow(t, { meta: taskMeta(t).filter((m) => !m.includes('dot-c') && !m.includes(esc(p.title))) })).join('')}</div>` : ''}
      <div class="btn-row" style="margin-top:12px"><button type="button" class="linkbtn" data-act="addToProject" data-id="${esc(p.id)}">+ Add task</button></div>
    </article>`;
  }).join('');
  return `<h1 class="title">Projects</h1>
    ${chipsHTML(new Set(S.tasks.filter((t) => t.kind === 'project').map((t) => t.category)))}
    <div class="projects">${cards || `<div class="empty"><b>No projects yet</b>Group related tasks under a project to track progress.<div style="margin-top:16px"><button type="button" class="btn primary" data-act="newProject">New project</button></div></div>`}</div>
    <div class="row-between" style="margin-top:14px"><span></span><button type="button" class="linkbtn" data-act="showDoneProjects">${S.showDoneProjects ? 'Hide finished' : 'Show finished'}</button></div>`;
}

function viewReview() {
  const ls = logSet(), now = new Date(), ds = ymd(now);
  const days = [...Array(7)].map((_, i) => addDays(now, i - 6));
  let schedSum = 0, doneSum = 0;
  const cols = days.map((d) => {
    const dd = ymd(d), sched = S.tasks.filter((t) => isScheduled(t, d));
    const dn = sched.filter((t) => ls.has(`${dd}|${t.id}`)).length;
    schedSum += sched.length; doneSum += dn;
    const pct = sched.length ? Math.round(dn / sched.length * 100) : 0;
    return `<div class="col${dd === ds ? ' today' : ''}"><span class="pct">${sched.length ? pct + '%' : '–'}</span><div class="bar${pct ? '' : ' zero'}" style="height:${Math.max(pct, 3)}%"></div><span class="lbl">${DAY[d.getDay()].slice(0, 2)}</span></div>`;
  }).join('');
  const weekStart = ymd(days[0]);
  const tasksDone = S.tasks.filter((t) => t.kind === 'task' && t.done_at && t.done_at >= weekStart);
  const overdue = S.tasks.filter((t) => t.kind === 'task' && t.status !== 'done' && t.due && t.due < ds);
  // completions per category (routine check-ins + finished tasks)
  const perCat = {};
  S.log.filter((l) => l.date >= weekStart).forEach((l) => { const t = byId(l.id); if (t) perCat[t.category] = (perCat[t.category] || 0) + 1; });
  tasksDone.forEach((t) => { perCat[t.category] = (perCat[t.category] || 0) + 1; });
  const max = Math.max(1, ...Object.values(perCat));
  const catRows = Object.entries(perCat).sort((a, b) => b[1] - a[1]).map(([n, v]) =>
    `<div class="cat-row" style="--c:${esc(catColor(n))}"><span class="name"><span class="dot-c"></span>${esc(n)}</span><div class="track"><div class="fill" style="width:${Math.round(v / max * 100)}%"></div></div><b>${v}</b></div>`).join('');
  return `<h1 class="title">Review</h1>
    <div class="stats">
      <div class="card stat"><span>Streak</span><b>${streak()}<small> days</small></b></div>
      <div class="card stat"><span>Routine, 7 days</span><b>${schedSum ? Math.round(doneSum / schedSum * 100) : 0}<small>%</small></b></div>
      <div class="card stat"><span>Tasks done, 7 days</span><b>${tasksDone.length}</b></div>
      <div class="card stat"><span>Overdue</span><b style="${overdue.length ? 'color:var(--danger)' : ''}">${overdue.length}</b></div>
    </div>
    <h2 class="section">Routine completion</h2>
    <div class="card"><div class="week">${cols}</div></div>
    <h2 class="section">Done by category, 7 days</h2>
    <div class="card">${catRows ? `<div class="cats">${catRows}</div>` : '<div class="empty" style="padding:12px">Nothing completed yet this week.</div>'}</div>
    ${overdue.length ? section('Overdue', overdue.length, overdue.map((t) => itemRow(t, { meta: taskMeta(t) })).join('')) : ''}
    ${tasksDone.length ? section('Finished this week', tasksDone.length, tasksDone.sort((a, b) => b.done_at.localeCompare(a.done_at)).map((t) => itemRow(t, { done: true, meta: [metaTxt(fmtDate(t.done_at)), metaCat(t)] })).join('')) : ''}`;
}

function viewSettings() {
  const c = Conn.get();
  const used = (n) => S.tasks.filter((t) => t.category === n).length;
  const wk = weekendDays();
  const pushText = {
    on: 'On for this device.',
    off: 'Off on this device.',
    denied: 'Blocked. Allow notifications for Daybook in iPhone Settings › Notifications.',
    'home-screen': 'On iPhone, open Daybook from your Home Screen first (Share › Add to Home Screen).',
    unsupported: 'This browser does not support push notifications.',
    unknown: 'Checking…',
  }[S.push];
  return `<h1 class="title">Settings</h1>
  <div class="settings" style="margin-top:18px">
    <section class="card">
      <h3>Profile</h3>
      <label class="field"><span>Name</span><input data-setting="name" value="${esc(S.settings.name)}" placeholder="Your name"></label>
    </section>

    <section class="card">
      <div class="row-between"><h3>Categories</h3><span class="hint">${S.categories.length} total</span></div>
      ${S.categories.map((cat, i) => `<div class="cat-edit">
        <input class="swatch" type="color" value="${esc(cat.color)}" data-catcolor="${i}" aria-label="Color for ${esc(cat.name)}">
        <input type="text" value="${esc(cat.name)}" data-catname="${i}" aria-label="Category name">
        <span class="hint" style="min-width:24px;text-align:right">${used(cat.name)}</span>
        <button type="button" class="iconbtn" data-act="delCat" data-i="${i}" aria-label="Delete ${esc(cat.name)}">${ICON.trash}</button>
      </div>`).join('')}
      <form class="cat-edit" id="addCatForm">
        <input type="text" name="cat" placeholder="New category, e.g. Side projects" aria-label="New category name">
        <button class="btn" type="submit">Add</button>
      </form>
    </section>

    <section class="card">
      <h3>Reminders</h3>
      <p class="hint">${esc(pushText)}</p>
      <div class="btn-row">
        ${S.push === 'on' ? '' : `<button type="button" class="btn primary" data-act="enablePush" ${['unsupported', 'denied'].includes(S.push) ? 'disabled' : ''}>Turn on notifications</button>`}
        <button type="button" class="btn" data-act="testPush">Send test notification</button>
      </div>
      <div class="grid2">
        <label class="field"><span>Morning summary</span><input type="time" data-setting="digest" value="${esc(S.settings.digest)}"></label>
        <label class="field"><span>Evening wrap-up</span><input type="time" data-setting="wrap" value="${esc(S.settings.wrap)}"></label>
      </div>
      <label class="field"><span>Remind me before a timed item</span>
        <select data-setting="lead">${['0', '10', '15', '30'].map((v) => `<option value="${v}" ${S.settings.lead === v ? 'selected' : ''}>${v === '0' ? 'At the time' : v + ' minutes'}</option>`).join('')}</select></label>
      <div class="field"><span>Weekend days</span>
        <div class="days">${DAY.map((d) => `<label><input type="checkbox" data-weekend="${d}" ${wk.includes(d) ? 'checked' : ''}><span>${d.slice(0, 2)}</span></label>`).join('')}</div></div>
      <p class="hint">GitHub checks every 30 minutes between 5 AM and midnight (${esc(S.settings.timezone)}), so a reminder can land up to about half an hour early or late.</p>
    </section>

    <section class="card">
      <h3>Data</h3>
      <div class="kv"><span>Repository</span><span>${esc(c.owner)}/${esc(c.repo)}</span></div>
      <div class="kv"><span>Last sync</span><span>${S.lastSync ? new Date(S.lastSync).toLocaleString() : '—'}</span></div>
      <div class="btn-row">
        <button type="button" class="btn" data-act="syncNow">Sync now</button>
        <button type="button" class="btn" data-act="installBackend">Reinstall reminder workflow</button>
        <button type="button" class="btn danger" data-act="disconnect">Disconnect this device</button>
      </div>
      <p class="hint">Daybook ${VERSION}</p>
    </section>
  </div>`;
}

const VIEWS = { today: viewToday, tasks: viewTasks, projects: viewProjects, review: viewReview, settings: viewSettings };
function render() {
  if ($('#app').hidden) return;
  const navHTML = (cls) => NAV.map(([k, l, ic]) => `<button type="button" class="${cls}" data-act="nav" data-view="${k}" ${S.view === k ? 'aria-current="page"' : ''}>${ic}<span>${l}</span></button>`).join('');
  $('#tabbar').innerHTML = navHTML('tab');
  $('#railLinks').innerHTML = navHTML('rail-link');
  $('#topTitle').textContent = S.view === 'today'
    ? new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    : 'Daybook';
  const active = document.activeElement;
  const keepSearch = active && active.id === 'search';
  $('#view').innerHTML = VIEWS[S.view]();
  if (keepSearch) { const s = $('#search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  setSync(S.sync);
}

/* ---------- add / edit sheet ---------- */
function openSheet(t, preset = {}) {
  const isNew = !t;
  const firstCat = S.cat !== 'All' ? S.cat : (S.categories[0]?.name || 'Personal');
  t = t ? { ...t } : {
    id: uid(), title: '', category: preset.category || firstCat, kind: preset.kind || 'task',
    repeat: 'daily', days: '', time: '', due: preset.due ?? '', project: preset.project || '',
    priority: 'normal', status: 'open', remind: '1', notes: '', created: today(), done_at: '',
  };
  const projects = S.tasks.filter((p) => p.kind === 'project' && (p.status !== 'done' || p.id === t.project));
  const cats = [...S.categories.map((c) => c.name)];
  if (t.category && !cats.includes(t.category)) cats.push(t.category);
  const days = (t.days || '').split(/\s+/);
  const sheet = $('#sheet');
  sheet.innerHTML = `<form class="sheet-form" id="sheetForm" data-kind="${esc(t.kind)}" data-repeat="${esc(t.repeat || 'daily')}" novalidate>
    <div class="sheet-grab" aria-hidden="true"></div>
    <div class="sheet-head"><h2 id="sheetTitle">${isNew ? 'New item' : 'Edit'}</h2><button type="button" class="linkbtn" data-act="closeSheet">Cancel</button></div>
    <input class="title-input" name="title" value="${esc(t.title)}" placeholder="What do you need to do?" aria-label="Title" required>
    <div class="seg" role="radiogroup" aria-label="Type">
      ${[['task', 'Task'], ['routine', 'Routine'], ['project', 'Project']].map(([k, l]) => `<label><input type="radio" name="kind" value="${k}" ${t.kind === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </div>
    <label class="field"><span>Category</span>
      <select name="category">${cats.map((n) => `<option ${n === t.category ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__new">+ New category…</option></select></label>

    <label class="field only-routine"><span>Repeat</span>
      <select name="repeat">${[['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends'], ['custom', 'Choose days']].map(([v, l]) => `<option value="${v}" ${t.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="field days-wrap"><span>Days</span><div class="days">${DAY.map((d) => `<label><input type="checkbox" name="days" value="${d}" ${days.includes(d) ? 'checked' : ''}><span>${d.slice(0, 2)}</span></label>`).join('')}</div></div>

    <div class="grid2 only-task">
      <label class="field"><span>Due date</span><input type="date" name="due" value="${esc(t.kind === 'task' ? t.due : '')}"></label>
      <label class="field"><span>Time</span><input type="time" name="time" value="${esc(t.kind !== 'project' ? t.time : '')}"></label>
    </div>
    <label class="field only-routine"><span>Time</span><input type="time" name="rtime" value="${esc(t.kind === 'routine' ? t.time : '')}"></label>
    <label class="field only-project"><span>Target date</span><input type="date" name="pdue" value="${esc(t.kind === 'project' ? t.due : '')}"></label>

    <div class="grid2 only-task">
      <label class="field"><span>Project</span><select name="project"><option value="">None</option>${projects.map((p) => `<option value="${esc(p.id)}" ${p.id === t.project ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
      <label class="field"><span>Priority</span><select name="priority">${['low', 'normal', 'high'].map((v) => `<option value="${v}" ${t.priority === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>
    </div>

    <label class="switch not-project"><span>Notify me</span><input type="checkbox" name="remind" ${t.remind !== '0' ? 'checked' : ''}></label>
    <label class="switch only-routine"><span>Paused</span><input type="checkbox" name="paused" ${t.status === 'paused' ? 'checked' : ''}></label>
    <label class="switch only-project"><span>Finished</span><input type="checkbox" name="pdone" ${t.kind === 'project' && t.status === 'done' ? 'checked' : ''}></label>
    <label class="field"><span>Notes</span><textarea name="notes" placeholder="Optional">${esc(t.notes)}</textarea></label>
    ${urlsIn(t.notes).length ? `<div class="links">${urlsIn(t.notes).map((u) => `<a class="btn" href="${esc(u)}"${linkTarget(u)}>Open ${esc(linkLabel(u))} ↗</a>`).join('')}</div>` : ''}
    <p class="error" id="sheetError" hidden></p>
    <div class="sheet-actions">
      ${isNew ? '' : '<button type="button" class="btn danger" data-act="deleteItem">Delete</button>'}
      <button type="submit" class="btn primary">${isNew ? 'Add' : 'Save'}</button>
    </div>
  </form>`;
  const form = $('#sheetForm');
  form._item = t; form._isNew = isNew;
  form.addEventListener('change', (e) => {
    if (e.target.name === 'kind') form.dataset.kind = e.target.value;
    if (e.target.name === 'repeat') form.dataset.repeat = e.target.value;
    if (e.target.name === 'category' && e.target.value === '__new') {
      const name = (prompt('New category name') || '').trim();
      const sel = e.target;
      if (name && !S.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        S.categories.push({ name, color: PALETTE[S.categories.length % PALETTE.length] });
        save('categories');
        sel.insertAdjacentHTML('afterbegin', `<option>${esc(name)}</option>`);
      }
      const match = S.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      sel.value = match ? match.name : t.category;
    }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); submitSheet(form); });
  sheet.showModal();
  if (isNew) setTimeout(() => form.elements.title.focus(), 50);
}
function closeSheet() { const s = $('#sheet'); if (s.open) s.close(); }
function submitSheet(form) {
  const f = new FormData(form), t = form._item;
  const title = String(f.get('title') || '').trim();
  if (!title) { const e = $('#sheetError'); e.textContent = 'Give it a title.'; e.hidden = false; form.elements.title.focus(); return; }
  const prevKind = t.kind;
  t.title = title;
  t.kind = f.get('kind');
  t.category = f.get('category') === '__new' ? (S.categories[0]?.name || 'Personal') : f.get('category');
  t.notes = String(f.get('notes') || '').trim();
  t.remind = f.get('remind') ? '1' : '0';
  if (t.kind === 'routine') {
    t.repeat = f.get('repeat'); t.days = t.repeat === 'custom' ? f.getAll('days').join(' ') : '';
    t.time = f.get('rtime') || ''; t.due = ''; t.project = ''; t.priority = 'normal';
    t.status = f.get('paused') ? 'paused' : 'active'; t.done_at = '';
  } else if (t.kind === 'task') {
    t.due = f.get('due') || ''; t.time = f.get('time') || ''; t.project = f.get('project') || ''; t.priority = f.get('priority') || 'normal';
    t.repeat = ''; t.days = '';
    if (prevKind !== 'task' || !['open', 'done'].includes(t.status)) { t.status = 'open'; t.done_at = ''; }
  } else {
    t.due = f.get('pdue') || ''; t.time = ''; t.project = ''; t.repeat = ''; t.days = ''; t.priority = 'normal'; t.remind = '0';
    const finished = !!f.get('pdone');
    if (finished && t.status !== 'done') { t.status = 'done'; t.done_at = today(); }
    if (!finished) { t.status = 'open'; t.done_at = ''; }
  }
  if (t.kind === 'routine' && t.repeat === 'custom' && !t.days) { const e = $('#sheetError'); e.textContent = 'Pick at least one day.'; e.hidden = false; return; }
  const i = S.tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) S.tasks[i] = t; else S.tasks.push(t);
  if (prevKind === 'project' && t.kind !== 'project') S.tasks.forEach((x) => { if (x.project === t.id) x.project = ''; });
  closeSheet();
  save('tasks');
  toast(form._isNew ? 'Added' : 'Saved');
}
function deleteItem() {
  const t = $('#sheetForm')._item;
  if (!confirm(`Delete “${t.title}”?`)) return;
  S.tasks = S.tasks.filter((x) => x.id !== t.id);
  S.tasks.forEach((x) => { if (x.project === t.id) x.project = ''; });
  S.log = S.log.filter((l) => l.id !== t.id);
  closeSheet();
  save('tasks', 'log');
  toast('Deleted');
}

/* ---------- categories ---------- */
function renameCategory(i, name) {
  name = name.trim();
  const cat = S.categories[i]; if (!cat) return;
  if (!name || name === cat.name) { render(); return; }
  if (S.categories.some((c, j) => j !== i && c.name.toLowerCase() === name.toLowerCase())) { toast('That category already exists'); render(); return; }
  S.tasks.forEach((t) => { if (t.category === cat.name) t.category = name; });
  if (S.cat === cat.name) S.cat = name;
  cat.name = name;
  save('categories', 'tasks');
}
function deleteCategory(i) {
  const cat = S.categories[i]; if (!cat) return;
  if (S.categories.length === 1) { toast('Keep at least one category'); return; }
  const n = S.tasks.filter((t) => t.category === cat.name).length;
  const target = S.categories.find((c, j) => j !== i).name;
  if (!confirm(n ? `Delete “${cat.name}”? Its ${n} item${n > 1 ? 's' : ''} will move to “${target}”.` : `Delete “${cat.name}”?`)) return;
  S.tasks.forEach((t) => { if (t.category === cat.name) t.category = target; });
  S.categories.splice(i, 1);
  if (S.cat === cat.name) S.cat = 'All';
  save('categories', 'tasks');
}

/* ---------- push notifications ---------- */
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function refreshPushState() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      S.push = isIOS() && !isStandalone() ? 'home-screen' : 'unsupported';
    } else if (Notification.permission === 'denied') S.push = 'denied';
    else {
      const reg = await navigator.serviceWorker.ready;
      S.push = (await reg.pushManager.getSubscription()) && Notification.permission === 'granted' ? 'on' : 'off';
    }
  } catch { S.push = 'unsupported'; }
  if (S.view === 'settings') render();
}
async function enablePush(btn) {
  if (S.push === 'home-screen') { toast('Add Daybook to your Home Screen, then open it from there.'); return; }
  btn.disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications were not allowed.'); return; }
    const reg = await navigator.serviceWorker.ready;
    const file = await ghGet(PUSH_FILE);
    const cfg = file ? JSON.parse(file.text) : { subscriptions: [] };
    cfg.subscriptions = cfg.subscriptions || [];
    if (!cfg.vapid) {
      // One VAPID key pair for this Daybook, created on the device; the private half lives only in the private repo.
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
      cfg.vapid = { publicKey: b64u(raw), privateKey: jwk.d };
    }
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const k = sub.options && sub.options.applicationServerKey ? b64u(new Uint8Array(sub.options.applicationServerKey)) : '';
      if (k !== cfg.vapid.publicKey) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(cfg.vapid.publicKey) });
    const j = sub.toJSON();
    cfg.subscriptions = cfg.subscriptions.filter((s) => s.endpoint !== j.endpoint);
    cfg.subscriptions.push({ endpoint: j.endpoint, keys: j.keys, device: isIOS() ? 'iPhone' : (navigator.userAgentData?.platform || 'Browser'), added: today() });
    cfg.contact = location.origin.startsWith('https://') ? location.origin : 'https://github.com';
    await ghPutSafe(PUSH_FILE, JSON.stringify(cfg, null, 2) + '\n', 'Daybook: enable notifications');
    S.push = 'on';
    toast('Notifications are on. Try “Send test notification”.');
  } catch (e) {
    console.error(e);
    toast(`Couldn’t turn on notifications: ${e.message}`);
  } finally { btn.disabled = false; render(); }
}
async function testPush() {
  const c = Conn.get();
  try {
    const r = await api('/actions/workflows/remind.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: c.branch, inputs: { mode: 'test' } }) });
    if (r.status === 204) toast('Sent to GitHub. It should arrive in about a minute.');
    else if (r.status === 404) toast('Reminder workflow not found. Tap “Reinstall reminder workflow”.');
    else if (r.status === 403) toast('The token needs Actions: Read and write.');
    else toast(`GitHub error ${r.status}`);
  } catch { toast('You seem to be offline.'); }
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'nav': S.view = el.dataset.view; render(); window.scrollTo({ top: 0 }); if (S.view === 'settings') refreshPushState(); break;
    case 'toggle': toggle(id); break;
    case 'edit': openSheet(byId(id)); break;
    case 'add': openSheet(null, S.view === 'projects' ? { kind: 'project' } : S.view === 'today' ? { due: today() } : {}); break;
    case 'newProject': openSheet(null, { kind: 'project' }); break;
    case 'addToProject': { const p = byId(id); openSheet(null, { kind: 'task', project: id, category: p?.category }); break; }
    case 'closeSheet': closeSheet(); break;
    case 'deleteItem': deleteItem(); break;
    case 'cat': S.cat = el.dataset.cat; render(); break;
    case 'kind': S.kind = el.dataset.kind; render(); break;
    case 'showDone': S.showDone = !S.showDone; render(); break;
    case 'showDoneProjects': S.showDoneProjects = !S.showDoneProjects; render(); break;
    case 'delCat': deleteCategory(Number(el.dataset.i)); break;
    case 'enablePush': enablePush(el); break;
    case 'testPush': testPush(); break;
    case 'syncNow': try { await flush(); await pull(); toast('Up to date'); } catch (err) { setSync('error'); toast(err.message); } break;
    case 'installBackend':
      el.disabled = true;
      try { await installBackend(); toast('Reminder workflow installed'); }
      catch (err) { toast('Install failed. The token needs Workflows: Read and write.'); console.error(err); }
      finally { el.disabled = false; }
      break;
    case 'disconnect':
      if (confirm('Disconnect this device? Your data stays in GitHub.')) { Conn.clear(); location.reload(); }
      break;
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { S.q = e.target.value; $('#taskList').innerHTML = taskListHTML(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.closest('#sheet')) return;
  if (t.dataset.setting) { S.settings[t.dataset.setting] = t.value.trim(); save('settings'); }
  else if (t.dataset.weekend) {
    S.settings.weekend = $$('[data-weekend]').filter((x) => x.checked).map((x) => x.dataset.weekend).join(' ');
    save('settings');
  } else if (t.dataset.catname != null) renameCategory(Number(t.dataset.catname), t.value);
  else if (t.dataset.catcolor != null) { S.categories[Number(t.dataset.catcolor)].color = t.value.toUpperCase(); save('categories'); }
});
document.addEventListener('submit', (e) => {
  if (e.target.id === 'addCatForm') {
    e.preventDefault();
    const name = e.target.elements.cat.value.trim();
    if (!name) return;
    if (S.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) { toast('That category already exists'); return; }
    S.categories.push({ name, color: PALETTE[S.categories.length % PALETTE.length] });
    save('categories');
  }
});
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); }); // tap backdrop to close
window.addEventListener('online', () => { flush(); });
window.addEventListener('offline', () => setSync('offline'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Conn.get() && !$('#app').hidden) { render(); flush().then(() => pull()).catch(() => setSync('error')); }
});
setInterval(() => { if (!document.hidden && !$('#sheet').open && document.activeElement?.tagName !== 'INPUT') render(); }, 60_000);

/* ---------- setup + boot ---------- */
$('#setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, err = $('#setupError'), btn = $('button[type="submit"]', f);
  const el = f.elements;
  const conn = { owner: el.owner.value.trim(), repo: el.repo.value.trim(), token: el.token.value.trim() };
  const name = el.name.value.trim();
  err.hidden = true; btn.disabled = true; btn.textContent = 'Connecting…';
  const fail = (m) => { err.textContent = m; err.hidden = false; btn.disabled = false; btn.textContent = 'Connect'; };
  try {
    const r = await api('', {}, conn);
    if (r.status === 401) return fail('GitHub rejected the token. Check it was copied fully and has not expired.');
    if (r.status === 404) return fail('Repo not found. Check the username and repo name, and that the token has access to this repo.');
    if (!r.ok) return fail(`GitHub error ${r.status}.`);
    const repo = await r.json();
    if (!repo.private) return fail('That repo is public. Make it private (repo Settings › General › Danger Zone), then connect.');
    Conn.set({ ...conn, branch: repo.default_branch || 'main' });
    Object.assign(S, { tasks: [], categories: [], log: [], settings: { ...DEFAULT_SETTINGS }, sha: {}, dirty: new Set() });
    const res = await pull();
    if (res === 'empty') {
      S.categories = DEFAULT_CATS.map((c) => ({ ...c }));
      S.settings = { ...DEFAULT_SETTINGS, name };
      S.dirty = new Set(Object.keys(FILES));
      persist();
      await flush();
      if (S.dirty.size) return fail('Could not create the data files. The token needs Contents: Read and write.');
    } else if (name && !S.settings.name) { S.settings.name = name; S.dirty.add('settings'); await flush(); }
    let workflowOk = true;
    if (!(await ghGet('.github/workflows/remind.yml'))) { try { await installBackend(); } catch (x) { console.error(x); workflowOk = false; } }
    showApp();
    toast(workflowOk ? 'Connected' : 'Connected. Reminder workflow not installed: the token needs Workflows access.');
  } catch (x) {
    console.error(x);
    fail(navigator.onLine ? `Something went wrong: ${x.message}` : 'You are offline.');
  }
});
function showApp() {
  $('#setup').hidden = true; $('#app').hidden = false;
  $('.fab').innerHTML = ICON.plus;
  render();
}
function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!Conn.get()) { $('#setup').hidden = false; return; }
  loadCache();
  if (!S.categories.length) S.categories = DEFAULT_CATS.map((c) => ({ ...c }));
  showApp();
  flush().then(() => pull()).catch((e) => { console.error(e); setSync(navigator.onLine ? 'error' : 'offline'); });
  refreshPushState();
}
boot();
