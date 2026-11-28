// HUD: telemetry, wellhead list and inspector, events and log, settings, alerts, captions,
// phone bottom sheet, cinematic mode, labels in the 3D view.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { safeGet, safeSet } from '../core/quality.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class HUD {
  constructor(ctx) {
    this.ctx = ctx;
    this.phone = false;
    this.tab = 'field';
    this.labels = new Map();
    this.layout();
    window.addEventListener('resize', () => this.layout());
    this.bind();
    this.lastTele = 0;
  }

  // ------------------------------------------------------------ layout (desktop panel vs phone sheet)
  layout() {
    const phone = window.matchMedia('(max-width: 760px), (max-height: 520px) and (max-width: 1000px)').matches;
    const views = $('pane-views'), map = $('pane-map'), sheet = $('sheet'), hud = $('hud');
    if (phone && views.parentElement !== sheet) { sheet.appendChild(views); sheet.appendChild(map); }
    if (!phone && views.parentElement !== hud) { hud.appendChild(views); hud.appendChild(map); views.style.position = 'absolute'; map.style.position = 'absolute'; }
    if (phone) { views.style.position = ''; map.style.position = ''; }
    this.phone = phone;
    this.showTab(this.tab, true);
    this.ctx.fieldmap && this.ctx.fieldmap.resize();
  }

  showTab(name, keep) {
    if (!this.phone && (name === 'views' || name === 'map')) name = 'field';
    const sheet = $('sheet');
    if (this.phone && !keep && this.tab === name && !sheet.classList.contains('collapsed')) { sheet.classList.add('collapsed'); return; }
    if (!keep) sheet.classList.remove('collapsed');
    this.tab = name;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    const panes = { field: $('pane-field'), events: $('pane-events'), views: $('pane-views'), map: $('pane-map') };
    for (const [k, el] of Object.entries(panes)) {
      if (!this.phone && (k === 'views' || k === 'map')) { el.classList.remove('hidden'); continue; }
      el.classList.toggle('hidden', k !== name);
    }
    if (name === 'map') this.ctx.fieldmap && this.ctx.fieldmap.resize();
  }

  // ------------------------------------------------------------ bindings
  bind() {
    const c = this.ctx;
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { this.showTab(b.dataset.tab); c.audio.ui('ui_click'); }));
    if (window.matchMedia('(max-width: 760px)').matches) $('sheet').classList.add('collapsed');
    document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x === b));
      c.rig.stopTour(); c.rig.go(b.dataset.cam); c.audio.ui('ui_click');
      if (this.phone) $('sheet').classList.add('collapsed');
    }));
    $('btn-tour').addEventListener('click', () => { if (c.rig.tour) c.rig.stopTour(); else c.rig.startTour(); if (this.phone) $('sheet').classList.add('collapsed'); });
    c.rig.addEventListener('tour', (e) => { $('btn-tour').textContent = e.detail ? '■ Stop tour' : '▶ Tour'; });
    c.rig.addEventListener('preset', (e) => {
      document.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x.dataset.cam === e.detail.key));
      this.caption(e.detail.caption);
    });
    c.rig.addEventListener('follow', (e) => { $('follow-chip').classList.toggle('hidden', !e.detail); });
    $('btn-unfollow').addEventListener('click', () => c.rig.stopFollow());

    $('btn-add').addEventListener('click', () => this.setAddMode(!c.state.addMode));
    $('btn-close-insp').addEventListener('click', () => this.select(null));
    $('btn-fly').addEventListener('click', () => { c.rig.go('wellhead'); });
    $('btn-del').addEventListener('click', () => {
      const w = c.state.selected; if (!w) return;
      if (!c.field.removeWellhead(w)) this.alert({ text: 'At least one wellhead must stay online.', tone: 'amber' });
    });

    $('ev-heli').addEventListener('click', () => { if (c.heli.trigger() === false) this.alert({ text: 'The helicopter is already flying.', tone: 'amber' }); });
    $('ev-vessel').addEventListener('click', () => { if (!c.vessel.trigger()) this.alert({ text: 'MV Halcyon Star is already at sea.', tone: 'sky' }); });
    // Marine sighting buttons: start the sighting (or use the one already in progress) and take the camera there
    const sighting = (kind, spawn) => {
      if (!c.marine.sightings[kind] && spawn) spawn.call(c.marine);
      if (c.marine.sightings[kind]) requestAnimationFrame(() => this.followMarine(kind));
    };
    $('ev-shark').addEventListener('click', () => sighting('whaleshark', c.marine.spawnWhaleShark));
    $('ev-whale').addEventListener('click', () => sighting('whale', c.marine.spawnWhale));
    $('ev-dolphin').addEventListener('click', () => sighting('dolphins', c.marine.spawnDolphins));
    $('ev-flyfish').addEventListener('click', () => sighting('flyingfish', c.marine.spawnFlyingFish));
    $('fol-heli').addEventListener('click', () => { if (c.heli.root.visible) { c.rig.follow(c.heli.root, new THREE.Vector3(-45, 18, 60)); $('follow-text').textContent = 'Following the helicopter'; } else this.alert({ text: 'Start a helicopter flight first.', tone: 'amber' }); });
    $('fol-vessel').addEventListener('click', () => { if (c.vessel.root.visible) { c.rig.follow(c.vessel.root, new THREE.Vector3(80, 40, 90)); $('follow-text').textContent = 'Following MV Halcyon Star'; } else this.alert({ text: 'Start a supply vessel voyage first.', tone: 'sky' }); });

    // settings
    $('btn-settings').addEventListener('click', () => $('settings').classList.toggle('hidden'));
    document.addEventListener('pointerdown', (e) => { const s = $('settings'); if (!s.classList.contains('hidden') && !s.contains(e.target) && e.target !== $('btn-settings')) s.classList.add('hidden'); });
    const tierSel = $('set-tier');
    tierSel.value = c.quality.auto ? 'auto' : c.quality.tierName;
    tierSel.addEventListener('change', () => {
      if (tierSel.value === 'auto') { try { localStorage.removeItem('hs.tier'); } catch (e) {} location.reload(); return; }
      c.quality.set(tierSel.value);
    });
    this.seg('set-tod', c.state.timeOfDay, (v) => c.setTimeOfDay(v));
    this.seg('set-sea', c.state.seaState, (v) => c.setSeaState(v));
    this.seg('set-speed', String(c.state.simSpeed), (v) => { c.state.simSpeed = +v; });
    this.seg('set-labels', c.state.labels ? 'on' : 'off', (v) => { c.state.labels = v === 'on'; safeSet('hs.labels', v); });
    $('set-vol').value = c.audio.volume;
    $('set-vol').addEventListener('input', (e) => c.audio.setVolume(+e.target.value));
    $('btn-shot').addEventListener('click', () => c.screenshot());
    $('btn-sound').addEventListener('click', () => this.toggleSound());
    $('btn-cinema').addEventListener('click', () => this.setCinema(true));
    $('btn-show').addEventListener('click', () => this.setCinema(false));
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'h' || e.key === 'H') this.setCinema(!document.body.classList.contains('cinema'));
      if (e.key === 'Escape') { this.setAddMode(false); c.rig.stopFollow(); }
    });
    setTimeout(() => $('help').classList.add('hidden'), 14000);
    this.updateTierInfo();
    c.quality.addEventListener('change', () => this.updateTierInfo());

    // events from the simulation
    c.events.on('log', (m) => this.log(m));
    c.events.on('alert', (a) => this.alert(a));
    c.events.on('timeskip', (m) => this.alert({ text: '⏩ ' + m, tone: 'skip' }));
    c.field.addEventListener('wellheads', (e) => this.onWellheads(e.detail));
    this.renderList();
  }

  seg(id, current, fn) {
    const el = $(id);
    el.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === current);
      b.addEventListener('click', () => { el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); this.ctx.audio.ui('ui_click'); });
    });
  }

  updateTierInfo() {
    const q = this.ctx.quality;
    $('tier-info').textContent = `Running on the ${q.tier.label} tier${q.auto ? ' (chosen automatically; it steps down if the frame rate drops)' : ''}.`;
  }

  toggleSound() {
    const a = this.ctx.audio;
    a.start().then(() => {
      a.setEnabled(!a.enabled);
      $('btn-sound').textContent = a.enabled ? '🔊' : '🔇';
      $('btn-sound').title = a.enabled ? 'Sound (on)' : 'Sound (off)';
      if (a.enabled && a.missing.size && !this.soundNoted) { this.soundNoted = true; this.log(`[SYS] Sound on. Files not yet supplied are skipped (${a.missing.size} missing so far).`); }
    });
  }

  setCinema(on) {
    document.body.classList.toggle('cinema', on);
    $('btn-show').classList.toggle('hidden', !on);
  }

  setAddMode(on) {
    this.ctx.state.addMode = on;
    $('btn-add').classList.toggle('on', on);
    $('btn-add').textContent = on ? 'Cancel' : '+ Add';
    if (on && this.phone) this.showTab('map', true);
  }

  // ------------------------------------------------------------ wellheads
  onWellheads({ type, w, silent }) {
    const c = this.ctx;
    if (type === 'add' && !silent) {
      this.log(`[FIELD] Commissioned ${w.code}; flowline tied back to HS-CPP (${(w.lineLength / 1000).toFixed(2)} km).`);
      this.alert({ text: `${w.code} deployed and tied back to HS-CPP`, tone: 'emerald' });
      c.audio.ui('ui_deploy');
      this.select(w);
    }
    if (type === 'move') this.log(`[FIELD] Relocated ${w.code}; flowline re-routed (${(w.lineLength / 1000).toFixed(2)} km).`);
    if (type === 'remove') { this.log(`[FIELD] Decommissioned ${w.code} and isolated its riser.`); if (c.state.selected === w) this.select(null); this.removeLabel('w' + w.id); }
    c.onFieldChanged();
    this.renderList();
    if (c.state.selected) this.inspect(c.state.selected);
  }

  renderList() {
    const ul = $('whp-list'); ul.innerHTML = '';
    for (const w of this.ctx.field.wellheads) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${w.code}</b><span>${(Math.hypot(w.x, w.z) / 1000).toFixed(1)} km · ${w.flow}</span>`;
      li.classList.toggle('on', this.ctx.state.selected === w);
      li.addEventListener('click', () => { this.select(w); this.ctx.audio.ui('ui_click'); });
      ul.appendChild(li);
    }
  }

  select(w) {
    this.ctx.state.selected = w;
    $('inspector').classList.toggle('hidden', !w);
    if (w) this.inspect(w);
    this.renderList();
  }

  inspect(w) {
    $('i-code').textContent = w.code;
    $('i-flow').textContent = `${w.flow} MMSCFD`;
    $('i-press').textContent = `${w.pressure} bar`;
    $('i-dist').textContent = `${(Math.hypot(w.x, w.z) / 1000).toFixed(2)} km`;
    $('i-line').textContent = `${(w.lineLength / 1000).toFixed(2)} km`;
    $('i-depth').textContent = `${(-this.ctx.seabed.heightAt(w.x, w.z)).toFixed(1)} m`;
  }

  // ------------------------------------------------------------ messages
  log(msg) {
    const ol = $('log'); const li = document.createElement('li');
    const t = new Date(); const time = document.createElement('time'); time.textContent = t.toTimeString().slice(0, 5);
    li.appendChild(time); li.appendChild(document.createTextNode(msg));
    ol.prepend(li);
    while (ol.children.length > 40) ol.lastChild.remove();
  }

  // Put the camera on a marine sighting and keep it there as the animal moves
  followMarine(kind) {
    const c = this.ctx;
    if (kind === 'flyingfish') {   // a short-lived burst: fly over to watch it rather than follow one fish
      const sh = c.marine.sightings.flyingfish; if (!sh || !sh.centre) return;
      const p = sh.centre, d = sh.dir || new THREE.Vector3(1, 0, 0);
      // watch from the sun's side, low over the water, so the shoal is lit and not lost in the glare
      const sun = c.sky && c.sky.sunDir ? new THREE.Vector3(c.sky.sunDir.x, 0, c.sky.sunDir.z) : new THREE.Vector3(-d.z, 0, d.x);
      if (sun.lengthSq() < 1e-4) sun.set(-d.z, 0, d.x);
      sun.normalize();
      c.rig.stopFollow();
      c.rig.flyTo(new THREE.Vector3(p.x + sun.x * 50 + d.x * 10, 7, p.z + sun.z * 50 + d.z * 10), new THREE.Vector3(p.x + d.x * 22, 1.5, p.z + d.z * 22), 1.6);
      return;
    }
    const obj = c.marine.target(kind); if (!obj) return;
    const p = new THREE.Vector3(); obj.getWorldPosition(p);
    // close enough to see through the water: the whale is ~14 m long, dolphins ~2.5 m
    const off = { whale: [20, 3, 22], dolphins: [9, 0, 11], whaleshark: [12, 2, 12] }[kind] || [12, 2, 12];
    c.camera.position.copy(p).add(new THREE.Vector3(...off));
    if (kind === 'whaleshark' || kind === 'whale') c.camera.position.y = Math.min(p.y + off[1], -2);
    if (kind === 'dolphins') c.camera.position.y = p.y - 1.6;   // the pod cruises 2-3 m down: watch from just under the surface
    c.rig.controls.target.copy(p);
    c.rig.follow(obj);
    $('follow-text').textContent = { whale: "Following the Bryde's whale", dolphins: 'Following the dolphin pod', whaleshark: 'Following the whale shark' }[kind] || 'Following';
  }

  alert({ text, tone = 'sky', follow }) {
    const box = $('alerts'); const el = document.createElement('div');
    el.className = 'alert ' + tone;
    el.appendChild(document.createTextNode(text));
    if (follow) {
      const b = document.createElement('button'); b.className = 'small ghost'; b.textContent = 'Follow';
      b.addEventListener('click', () => { this.followMarine(follow); el.remove(); });
      el.appendChild(b);
    }
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    this.ctx.audio.ui('ui_alert');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, follow ? 9000 : 5000);
  }

  caption(text) {
    const el = $('caption');
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text; el.classList.remove('hidden'); el.style.opacity = 1;
    clearTimeout(this.capT);
    this.capT = setTimeout(() => { el.style.opacity = 0; }, 7000);
  }

  // ------------------------------------------------------------ per frame
  update(dt, t) {
    const c = this.ctx;
    // depth / altitude badge
    const y = c.camera.position.y;
    const badge = $('depth-badge');
    const under = c.underwater.active;
    badge.classList.toggle('under', under);
    badge.textContent = c.rig.scene === 'shore' ? 'SHORE TERMINAL' : under ? `SUBSEA ${(c.underwater.depth).toFixed(1)} m` : `+${Math.max(0, y).toFixed(0)} m`;
    // telemetry at 4 Hz
    if (t - this.lastTele > 0.25) {
      this.lastTele = t;
      $('m-gas').textContent = fmt(c.telemetry.exportRate());
      $('m-whp').textContent = c.field.wellheads.length;
      $('m-press').textContent = c.telemetry.pressure().toFixed(1);
      $('m-log').textContent = `Vessel: ${c.vessel.status()} · Helicopter: ${c.heli.status()}`;
    }
    this.updateLabels();
  }

  // ------------------------------------------------------------ labels
  label(key, text, onClick) {
    let el = this.labels.get(key);
    if (!el) {
      el = document.createElement('div'); el.className = 'lbl';
      if (onClick) el.addEventListener('click', onClick);
      $('labels').appendChild(el); this.labels.set(key, el);
    }
    if (el.dataset.t !== text) { el.innerHTML = text; el.dataset.t = text; }
    return el;
  }
  removeLabel(key) { const el = this.labels.get(key); if (el) { el.remove(); this.labels.delete(key); } }

  updateLabels() {
    const c = this.ctx;
    const show = c.state.labels && c.rig.scene === 'field' && !document.body.classList.contains('cinema');
    const W = window.innerWidth, H = window.innerHeight;
    const v = new THREE.Vector3();
    const cam = c.camera.position;
    const place = (key, pos, text, onClick, extraClass, maxDist = 14000) => {
      const el = this.label(key, text, onClick);
      v.copy(pos).project(c.camera);
      const d = cam.distanceTo(pos);
      const vis = show && v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && d < maxDist && !(c.underwater.active && d > 60);
      el.style.display = vis ? '' : 'none';
      if (!vis) return;
      el.style.left = ((v.x * 0.5 + 0.5) * W) + 'px';
      el.style.top = ((-v.y * 0.5 + 0.5) * H - 8) + 'px';
      el.className = 'lbl' + (extraClass ? ' ' + extraClass : '');
      el.style.opacity = d < 30 ? Math.max(0, (d - 10) / 20) : 1;
    };
    const km = (p) => { const d = cam.distanceTo(p); return d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`; };
    const p1 = new THREE.Vector3(0, 66, 0), p2 = new THREE.Vector3(CONFIG.lq.x, 70, CONFIG.lq.z);
    place('cpp', p1, `HS-CPP<small>${km(p1)}</small>`, () => c.rig.go('cpp'));
    place('lq', p2, `HS-LQ<small>${km(p2)}</small>`, () => c.rig.go('helideck'));
    for (const w of c.field.wellheads) {
      const p = new THREE.Vector3(w.x, 36, w.z);
      place('w' + w.id, p, `${w.code}<small>${km(p)}</small>`, () => { this.select(w); c.rig.go('wellhead'); }, c.state.selected === w ? 'sel' : '');
    }
    if (c.vessel.root.visible) { const p = c.vessel.root.position.clone().setY(24); place('osv', p, `MV Halcyon Star<small>${km(p)}</small>`, () => $('fol-vessel').click(), 'moving'); }
    else this.label('osv', '').style.display = 'none';
    if (c.heli.root.visible) { const p = c.heli.root.position.clone().add(new THREE.Vector3(0, 9, 0)); place('heli', p, `Helicopter<small>${km(p)}</small>`, () => $('fol-heli').click(), 'moving'); }
    else this.label('heli', '').style.display = 'none';
  }
}
