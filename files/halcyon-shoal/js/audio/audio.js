// Sound engine. Files live in /audio as <id>.mp3 (see audio/README.md for the list).
// Missing files are skipped silently, so the app works before the sounds are delivered.
// Audio starts only after the first user interaction (browser requirement).
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const AMBIENT = [
  // id, type, position (world) or null for stereo beds, refDistance, volume
  ['amb_sea_calm', 'bed', null, 0, 0.6],
  ['amb_sea_rough', 'bed', null, 0, 0],
  ['amb_machinery', 'pos', [0, 36, 0], 25, 0.8],
  ['amb_flare', 'pos', 'flare', 40, 0.9],
  ['amb_hvac', 'pos', [CONFIG.lq.x, 44, CONFIG.lq.z], 12, 0.5],
  ['amb_waves_steel', 'pos', [-19.8, 0, -28.8], 10, 0.7],
  ['amb_waves_steel', 'pos', [19.8, 0, 10.8], 10, 0.7],
  ['uw_ambience', 'uwbed', null, 0, 0.7],
  ['uw_machinery', 'uwpos', [0, -20, 0], 15, 0.7],
  ['uw_bubbles', 'uwpos', [-19.6, -30, -27], 6, 0.6]
];
const RANDOM_ONESHOTS = [['amb_gulls', 6, 12, 0.6], ['amb_metal_creak', 4, 9, 0.5]];

export class AudioSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = false; this.started = false;
    this.volume = ctx.settings.defaults.volume ?? 0.8;
    this.buffers = {}; this.missing = new Set(); this.loops = {};
    this.beds = []; this.uw = false; this.nextRandom = 8;
  }

  // Called on the first pointer/key interaction
  async start() {
    if (this.started) return; this.started = true;
    this.listener = new THREE.AudioListener();
    this.ctx.camera.add(this.listener);
    const ac = this.listener.context;
    this.filter = ac.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 20000;
    this.listener.gain.disconnect(); this.listener.gain.connect(this.filter); this.filter.connect(ac.destination);
    this.listener.setMasterVolume(this.enabled ? this.volume : 0);
    try {   // only request files listed as supplied (avoids 404s before the sounds are delivered)
      const m = await (await fetch('audio/manifest.json', { cache: 'no-cache' })).json();
      this.available = new Set(m.available || []);
    } catch (e) { this.available = null; }
    for (const [id, type, p, ref, vol] of AMBIENT) {
      const buf = await this.load(id); if (!buf) continue;
      let snd;
      if (type === 'bed' || type === 'uwbed') { snd = new THREE.Audio(this.listener); }
      else {
        snd = new THREE.PositionalAudio(this.listener); snd.setRefDistance(ref); snd.setRolloffFactor(1.6); snd.setDistanceModel('inverse');
        const holder = new THREE.Object3D();
        if (p === 'flare') holder.position.copy(this.ctx.field.flareTip); else holder.position.set(...p);
        holder.add(snd); this.ctx.scene.add(holder);
      }
      snd.setBuffer(buf); snd.setLoop(true); snd.setVolume(type.startsWith('uw') ? 0 : vol); snd.play();
      this.beds.push({ id, type, snd, vol });
    }
    for (const id of ['heli_distant', 'heli_close', 'osv_engine', 'osv_thrusters', 'osv_hull_water']) this.load(id);
  }

  async load(id) {
    if (this.buffers[id]) return this.buffers[id];
    if (this.missing.has(id)) return null;
    if (this.available && !this.available.has(id)) { this.missing.add(id); return null; }
    try {
      const res = await fetch(`audio/${id}.mp3`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.arrayBuffer();
      this.buffers[id] = await this.listener.context.decodeAudioData(data);
      return this.buffers[id];
    } catch (e) { this.missing.add(id); return null; }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.listener) this.listener.setMasterVolume(on ? this.volume : 0);
  }
  setVolume(v) { this.volume = v; if (this.listener && this.enabled) this.listener.setMasterVolume(v); }

  ui(id) { if (this.started && this.enabled) this.play(id, null, 0.5); }

  async play(id, at, vol = 1, loopKey = null) {
    if (!this.started) return;
    const buf = await this.load(id); if (!buf) return;
    let snd;
    if (at) {
      snd = new THREE.PositionalAudio(this.listener); snd.setRefDistance(30); snd.setRolloffFactor(1.2);
      const h = new THREE.Object3D(); h.position.copy(at); h.add(snd); this.ctx.scene.add(h);
      snd.userData.holder = h;
    } else snd = new THREE.Audio(this.listener);
    snd.setBuffer(buf); snd.setVolume(vol);
    if (loopKey) { snd.setLoop(true); this.stop(loopKey); this.loops[loopKey] = snd; }
    else snd.onEnded = () => { snd.isPlaying = false; if (snd.userData.holder) this.ctx.scene.remove(snd.userData.holder); };
    snd.play();
  }
  stop(key) {
    const s = this.loops[key]; if (!s) return;
    try { s.stop(); } catch (e) { /* not started */ }
    if (s.userData.holder) this.ctx.scene.remove(s.userData.holder); else if (s.parent) s.parent.remove(s);
    delete this.loops[key];
  }

  handle(ev) {
    if (ev.stop) return this.stop(ev.stop);
    this.play(ev.id, ev.at || null, ev.vol ?? 1, ev.loop ? ev.key : null);
  }

  // Attach engine sounds to the moving vehicles and switch beds above / below water
  update(dt) {
    if (!this.started) return;
    const uw = this.ctx.underwater.active;
    if (uw !== this.uw) {
      this.uw = uw;
      const f = this.filter.frequency, now = this.listener.context.currentTime;
      f.cancelScheduledValues(now); f.setTargetAtTime(uw ? 650 : 20000, now, 0.12);
      this.play(uw ? 'cam_splash_in' : 'cam_splash_out', null, 0.8);
    }
    const sea = this.ctx.state.seaState;
    for (const b of this.beds) {
      let v = b.vol;
      if (b.type.startsWith('uw')) v = uw ? b.vol : 0; else v = uw ? b.vol * 0.25 : b.vol;
      if (b.id === 'amb_sea_calm') v *= sea === 'rough' ? 0.3 : 1;
      if (b.id === 'amb_sea_rough') v = (sea === 'rough' ? 0.8 : sea === 'moderate' ? 0.25 : 0) * (uw ? 0.2 : 1);
      b.snd.setVolume(v);
    }
    this.vehicle('heli', this.ctx.heli.root, this.ctx.heli.root.visible, this.ctx.heli.state);
    this.vehicle('osv', this.ctx.vessel.root, this.ctx.vessel.root.visible, this.ctx.vessel.state);
    this.vehicle('osvhull', this.ctx.vessel.root, this.ctx.vessel.root.visible && this.ctx.vessel.speed > 1.5, 'HULL');
    // gulls squabbling on the bridge (daytime, within earshot)
    const night = this.ctx.sky.presetName === 'night';
    const cam = this.ctx.camera.position;
    const wantPerch = !night && !uw && Math.hypot(cam.x + 50, cam.z - 6) < 450;
    if (wantPerch !== this.perchOn) { this.perchOn = wantPerch; if (wantPerch) this.play('gull_perched', new THREE.Vector3(-50, 34, 6), 0.7, 'perched'); else this.stop('perched'); }
    this.nextRandom -= dt;
    if (this.nextRandom < 0 && !uw) {
      const [id, a, b, vol] = RANDOM_ONESHOTS[Math.random() * RANDOM_ONESHOTS.length | 0];
      this.nextRandom = a + Math.random() * (b - a);
      if (id === 'amb_gulls' && night) return;
      const p = this.ctx.camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 10, (Math.random() - 0.5) * 60));
      this.play(id, p, vol);
    }
  }

  vehicle(kind, obj, visible, state) {
    const key = kind + '_loop';
    const want = !visible ? null : kind === 'osvhull' ? 'osv_hull_water' : kind === 'heli' ? (state === 'INBOUND' || state === 'OUTBOUND' ? 'heli_distant' : 'heli_close') : (state === 'APPROACH' || state === 'ALONGSIDE' || state === 'DEPART' ? 'osv_thrusters' : 'osv_engine');
    const cur = this.loops[key];
    if (!want) { if (cur) this.stop(key); return; }
    if (!cur || cur.userData.id !== want) {
      if (this.missing.has(want) || !this.buffers[want]) return;
      this.stop(key);
      const snd = new THREE.PositionalAudio(this.listener); snd.setRefDistance(kind === 'heli' ? 60 : 40); snd.setRolloffFactor(1.1);
      snd.setBuffer(this.buffers[want]); snd.setLoop(true); snd.setVolume(1); snd.userData.id = want;
      obj.add(snd); snd.play(); this.loops[key] = snd;
    }
  }
}
