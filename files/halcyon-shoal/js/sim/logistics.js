// Logistics: supply vessel voyages with crane cargo lifts, and helicopter crew-change flights.
// Transits from shore are skipped (time-skip notice); the last few kilometres play in real time.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { findNode } from '../core/assets.js';
import { softSprite } from '../core/noise.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const smooth = (t) => t * t * (3 - 2 * t);
const headingOf = (dx, dz) => Math.atan2(-dx, -dz);     // model bow/nose is -Z
function angLerp(a, b, k) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; }

// =============================================================================== vessel
export class Vessel {
  constructor(ctx, model) {
    this.ctx = ctx;
    this.root = new THREE.Group(); this.root.add(model);
    this.model = model;
    this.radar = [findNode(model, 'radar_1'), findNode(model, 'radar_2')];
    this.cargo = findNode(model, 'cargo_lift');
    this.cargoHome = this.cargo ? this.cargo.position.clone() : new THREE.Vector3();
    this.cargoParent = this.cargo ? this.cargo.parent : null;
    this.exhaust = [findNode(model, 'exhaust_l'), findNode(model, 'exhaust_r')];
    this.state = 'IDLE'; this.timer = ctx.settings.logistics.vesselFirstVoyageSeconds;
    this.pos = new THREE.Vector3(CONFIG.vesselSpawn.x, 0, CONFIG.vesselSpawn.z);
    this.heading = 0; this.speed = 0;
    this.motion = { heave: 0, pitch: 0, roll: 0 };
    this.trail = []; this.trailAcc = 0;
    this.root.visible = false;
    const st = CONFIG.vesselStation;
    this.station = new THREE.Vector3(st.x, 0, st.z);
    this.standby = new THREE.Vector3(st.x + 70, 0, st.z + 160);
    const far = new THREE.Vector3(1500, 0, 1250);
    this.inbound = new THREE.CatmullRomCurve3([far, new THREE.Vector3(800, 0, 760), new THREE.Vector3(300, 0, 380), this.standby]);
    this.outbound = new THREE.CatmullRomCurve3([this.standby.clone().add(new THREE.Vector3(30, 0, 40)), new THREE.Vector3(400, 0, 600), new THREE.Vector3(1100, 0, 1500), new THREE.Vector3(1900, 0, 2300)]);
    this.s = 0;
    // exhaust haze
    const tex = softSprite(32);
    this.puffs = [];
    for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x4a4644, transparent: true, depthWrite: false, opacity: 0 })); s.userData.ph = i / 12; this.puffs.push(s); ctx.scene.add(s); }
  }

  trigger() {
    if (this.state !== 'IDLE') return false;
    this.state = 'INBOUND'; this.s = 0; this.speed = 7; this.root.visible = true; this.trail = [];
    this.pos.copy(this.inbound.getPointAt(0));
    tmp.copy(this.inbound.getTangentAt(0)); this.heading = headingOf(tmp.x, tmp.z);
    this.ctx.events.emit('log', '[OSV] MV Halcyon Star: transit from the shore supply base skipped (about 6 h). Now 2 km out.');
    this.ctx.events.emit('alert', { text: 'Supply vessel MV Halcyon Star inbound, 2 km out', tone: 'sky' });
    this.ctx.events.emit('timeskip', 'Vessel transit from shore skipped · about 6 h');
    this.ctx.events.emit('sound', { id: 'osv_horn', at: this.pos });
    return true;
  }

  status() {
    return { IDLE: 'In port', INBOUND: 'Inbound', APPROACH: 'Positioning (DP)', ALONGSIDE: 'Cargo ops', DEPART: 'Departing', OUTBOUND: 'Outbound' }[this.state];
  }

  update(dt, t, waves) {
    const L = this.ctx.settings.logistics;
    const field = this.ctx.field;
    let thrusters = false;
    switch (this.state) {
      case 'IDLE':
        this.timer -= dt; if (this.timer <= 0) this.trigger(); break;
      case 'INBOUND': {
        const len = this.inbound.getLength();
        const remain = len - this.s;
        this.speed = Math.max(1.2, Math.min(7, Math.sqrt(2 * 0.045 * remain) + 0.6));
        this.s += this.speed * dt;
        const u = Math.min(1, this.s / len);
        this.pos.copy(this.inbound.getPointAt(u));
        tmp.copy(this.inbound.getTangentAt(u));
        this.heading = angLerp(this.heading, headingOf(tmp.x, tmp.z), Math.min(1, dt * 0.6));
        if (u >= 1) { this.state = 'APPROACH'; this.timer = 0; this.apStart = this.pos.clone(); this.apHead = this.heading; this.ctx.events.emit('log', '[OSV] At standby. Dynamic positioning engaged, backing in stern-to.'); }
        break;
      }
      case 'APPROACH': {
        this.timer += dt; thrusters = true;
        const k = smooth(Math.min(1, this.timer / 75));
        this.pos.lerpVectors(this.apStart, this.station, k);
        this.heading = angLerp(this.apHead, CONFIG.vesselStation.heading, smooth(Math.min(1, this.timer / 45)));
        this.speed = 1.5 * (1 - k);
        if (k >= 1) { this.state = 'ALONGSIDE'; this.timer = 0; this.liftPhase = 0; this.ctx.events.emit('log', '[OSV] Alongside HS-CPP. Crane lift in progress.'); this.ctx.events.emit('sound', { id: 'crane_alarm', loop: true, key: 'crane' }); }
        break;
      }
      case 'ALONGSIDE':
        thrusters = true;
        this.timer += dt;
        this.pos.x = this.station.x + Math.sin(t * 0.2) * 0.4; this.pos.z = this.station.z + Math.cos(t * 0.17) * 0.4;
        this.cargoLift(dt, L.vesselCargoSeconds);
        if (this.timer > L.vesselCargoSeconds + 4) { this.state = 'DEPART'; this.timer = 0; this.dpStart = this.pos.clone(); field.setCrane(null, 1); this.ctx.events.emit('sound', { stop: 'crane' }); this.ctx.events.emit('log', '[OSV] Cargo transfer complete. Departing for shore.'); this.ctx.events.emit('sound', { id: 'osv_horn', at: this.pos }); }
        break;
      case 'DEPART': {
        this.timer += dt; thrusters = true;
        const k = smooth(Math.min(1, this.timer / 50));
        const p0 = this.outbound.getPointAt(0);
        this.pos.lerpVectors(this.dpStart, p0, k);
        tmp.copy(this.outbound.getTangentAt(0));
        this.heading = angLerp(CONFIG.vesselStation.heading, headingOf(tmp.x, tmp.z), smooth(Math.min(1, this.timer / 40)));
        if (k >= 1) { this.state = 'OUTBOUND'; this.s = 0; this.speed = 1.5; }
        break;
      }
      case 'OUTBOUND': {
        this.speed = Math.min(7, this.speed + dt * 0.08);
        this.s += this.speed * dt;
        const len = this.outbound.getLength(); const u = Math.min(1, this.s / len);
        this.pos.copy(this.outbound.getPointAt(u)); tmp.copy(this.outbound.getTangentAt(u));
        this.heading = angLerp(this.heading, headingOf(tmp.x, tmp.z), Math.min(1, dt));
        if (u >= 1) { this.state = 'IDLE'; this.timer = L.vesselIdleSeconds; this.root.visible = false; this.trail = []; this.resetCargo(); this.ctx.events.emit('log', '[OSV] MV Halcyon Star clear of the field.'); }
        break;
      }
    }
    if (this.root.visible) this.float(dt, t, waves);
    if (this.radar[0]) this.radar[0].rotation.y += dt * 2.6;
    if (this.radar[1]) this.radar[1].rotation.y -= dt * 3.4;
    this.thrusters = thrusters && this.root.visible;
    this.updateTrail(dt);
    this.updatePuffs(dt, t);
  }

  float(dt, t, waves) {
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const at = (lx, lz) => waves.heightAt(this.pos.x + lx * ch + lz * sh, this.pos.z - lx * sh + lz * ch, t);
    const bow = at(0, -34), stern = at(0, 34), port = at(-8, 0), stbd = at(8, 0);
    const k = Math.min(1, dt * 1.2), m = this.motion;
    m.heave += ((bow + stern + port + stbd) * 0.25 * 0.85 - m.heave) * k;
    m.pitch += (Math.atan((bow - stern) / 68) * 0.8 - m.pitch) * k;
    m.roll += (Math.atan((stbd - port) / 16) * 0.7 - m.roll) * Math.min(1, dt * 0.8);
    this.root.position.set(this.pos.x, m.heave, this.pos.z);
    this.root.rotation.set(m.pitch, this.heading, m.roll, 'YXZ');
  }

  cargoLift(dt, total) {
    const field = this.ctx.field; if (!this.cargo || !field.crane) return;
    const ph = this.timer / total;          // 0..1
    const onDeck = this.cargoHome.clone().add(new THREE.Vector3(0, 6.6, 0));
    if (this.cargoParent) this.cargoParent.localToWorld(onDeck);      // hook point above the container, in world space
    const laydown = new THREE.Vector3(2, 36.3 + 6.6, 24);
    let target, attached = false;
    if (ph < 0.18) target = onDeck.clone().add(new THREE.Vector3(0, 12 * (1 - ph / 0.18), 0));
    else if (ph < 0.25) target = onDeck;
    else if (ph < 0.45) { attached = true; target = onDeck.clone().add(new THREE.Vector3(0, 40 * smooth((ph - 0.25) / 0.2), 0)); }
    else if (ph < 0.75) { attached = true; const k = smooth((ph - 0.45) / 0.3); target = onDeck.clone().add(new THREE.Vector3(0, 40, 0)).lerp(laydown.clone().add(new THREE.Vector3(0, 8, 0)), k); }
    else if (ph < 0.92) { attached = true; target = laydown.clone().add(new THREE.Vector3(0, 8 * (1 - smooth((ph - 0.75) / 0.17)), 0)); }
    else { target = laydown.clone().add(new THREE.Vector3(0, 10 * smooth((ph - 0.92) / 0.08), 0)); }
    field.setCrane(target, dt);
    if (attached || ph >= 0.92) {
      if (this.cargo.parent !== this.ctx.scene) { this.ctx.scene.attach(this.cargo); }
      if (attached) { field.hookWorld(tmp); this.cargo.position.copy(tmp).add(new THREE.Vector3(0, -6.6, 0)); this.cargo.rotation.set(0, this.heading + Math.sin(this.timer * 0.4) * 0.05, 0); }
      if (!this.liftLogged && attached) { this.liftLogged = true; this.ctx.events.emit('sound', { id: 'crane_winch', at: tmp.clone(), key: 'winch', loop: true }); }
    }
    if (ph >= 0.92 && !this.liftDone) { this.liftDone = true; this.ctx.events.emit('sound', { stop: 'winch' }); this.ctx.events.emit('sound', { id: 'cargo_set_down', at: this.cargo.position.clone() }); this.ctx.events.emit('log', '[OSV] Container landed on the HS-CPP laydown area.'); }
  }

  // the landed container stays on the platform; a fresh one is loaded before the next voyage
  resetCargo() {
    if (!this.cargo || !this.cargoParent) return;
    this.cargoParent.add(this.cargo); this.cargo.position.copy(this.cargoHome); this.cargo.rotation.set(0, 0, 0);
    this.liftDone = false; this.liftLogged = false;
  }

  updateTrail(dt) {
    if (!this.root.visible) { this.trail.length = 0; this.ctx.ocean.setTrail([]); return; }
    const moving = this.speed > 0.4;
    this.trailAcc += this.speed * dt;
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const stern = new THREE.Vector3(this.pos.x + 38 * sh, 0, this.pos.z + 38 * ch);
    if (moving && this.trailAcc > 10) { this.trailAcc = 0; this.trail.unshift({ x: stern.x, z: stern.z, w: 5, s: 0.55 }); }
    for (const p of this.trail) { p.w += dt * 0.7; p.s *= Math.pow(0.97, dt * 10); }
    while (this.trail.length > 38 || (this.trail.length && this.trail[this.trail.length - 1].s < 0.05)) this.trail.pop();
    const pts = [{ x: stern.x, z: stern.z, w: 4.5, s: moving ? 0.75 : 0 }, ...this.trail];
    this.ctx.ocean.setTrail(pts);
  }

  foamSpots() {
    if (!this.root.visible) return [];
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const P = (lx, lz) => [this.pos.x + lx * ch + lz * sh, this.pos.z - lx * sh + lz * ch];
    const out = [];
    const sp = Math.min(1, this.speed / 5);
    out.push([...P(0, -42), 7 + sp * 6, 0.3 + sp * 0.8]);          // bow wave
    out.push([...P(-9.8, -20), 4, 0.25 + sp * 0.5], [...P(9.8, -20), 4, 0.25 + sp * 0.5]);
    out.push([...P(-9.8, 15), 4, 0.3], [...P(9.8, 15), 4, 0.3]);
    if (this.thrusters) { out.push([...P(0, 46), 10, 0.85], [...P(-11, -34), 5, 0.6], [...P(11, -34), 5, 0.6]); }
    return out;
  }

  updatePuffs(dt, t) {
    for (const s of this.puffs) {
      s.visible = this.root.visible;
      if (!s.visible) continue;
      const src = this.exhaust[(s.userData.ph * 12) % 2 | 0]; if (!src) continue;
      src.getWorldPosition(tmp);
      const p = (s.userData.ph + t * 0.25) % 1;
      s.position.set(tmp.x + p * 14, tmp.y + p * 10, tmp.z + p * 8);
      s.scale.setScalar(1.5 + p * 9);
      s.material.opacity = 0.18 * Math.sin(p * Math.PI);
    }
  }
}

// =============================================================================== helicopter
export class Helicopter {
  constructor(ctx, model, crewModel) {
    this.ctx = ctx;
    this.root = new THREE.Group(); this.root.add(model); this.model = model;
    this.mainRotor = findNode(model, 'main_rotor'); this.tailRotor = findNode(model, 'tail_rotor');
    this.disc = findNode(model, 'rotor_disc'); this.tailDisc = findNode(model, 'tail_disc');
    this.strobes = [];
    model.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'emit_red') this.strobes.push(o); });
    this.landLight = new THREE.SpotLight(0xffffff, 0, 160, 0.5, 0.6, 1.5);
    const ll = findNode(model, 'landing_light');
    if (ll) { ll.add(this.landLight); this.landLight.target.position.set(0, -10, -6); ll.add(this.landLight.target); }
    this.rpm = 0;
    this.state = 'IDLE';
    this.timer = ctx.settings.logistics.helicopterFirstFlightSeconds;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.prevYaw = 0;
    this.root.visible = false;
    this.crew = [];
    for (let i = 0; i < 4; i++) { const c = crewModel.clone(true); c.visible = false; ctx.scene.add(c); this.crew.push({ obj: c, legs: [findNode(c, 'leg_l'), findNode(c, 'leg_r')], arms: [findNode(c, 'arm_l'), findNode(c, 'arm_r')] }); }
  }

  get deck() { return this.ctx.field.helideck; }

  trigger() {
    if (this.state !== 'IDLE') return false;
    const wind = this.ctx.wind;
    // approach from downwind, landing into wind
    const into = new THREE.Vector3(-Math.sin(wind.dir), 0, Math.cos(wind.dir));    // direction the wind comes from
    const d = this.deck;
    const finalDir = into.clone().negate();                                          // the downwind side
    const p4 = d.clone().add(new THREE.Vector3(0, 15, 0));
    const p3 = p4.clone().addScaledVector(finalDir, 320).setY(d.y + 70);
    const p2 = p4.clone().addScaledVector(finalDir, 1300).add(new THREE.Vector3(finalDir.z * 300, 0, -finalDir.x * 300)).setY(220);
    const p0 = new THREE.Vector3(CONFIG.heliSpawn.x, CONFIG.heliSpawn.y, CONFIG.heliSpawn.z).multiplyScalar(0.65).setY(400);
    const p1 = p0.clone().lerp(p2, 0.55).setY(330);
    this.path = new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4]);
    this.pathLen = this.path.getLength();
    this.landYaw = headingOf(into.x, into.z);
    this.s = 0; this.v = 65; this.state = 'INBOUND'; this.rpm = 1; this.root.visible = true;
    this.pos.copy(p0); tmp.copy(this.path.getTangentAt(0)); this.yaw = headingOf(tmp.x, tmp.z); this.prevYaw = this.yaw;
    this.ctx.events.emit('log', '[HELI] Crew-change flight: transit from shore skipped (about 35 min). Now 6 km out.');
    this.ctx.events.emit('alert', { text: 'Crew-change helicopter inbound to the HS-LQ helideck', tone: 'amber' });
    this.ctx.events.emit('timeskip', 'Helicopter transit from shore skipped · about 35 min');
    return true;
  }

  status() {
    return { IDLE: 'Standby ashore', INBOUND: 'Inbound', HOVER: 'Hover', LANDING: 'Landing', ONDECK: 'On deck · crew change', LIFTOFF: 'Lift-off', OUTBOUND: 'Outbound' }[this.state];
  }

  update(dt, t) {
    const L = this.ctx.settings.logistics;
    const d = this.deck;
    let pitchT = 0, rollT = 0;
    switch (this.state) {
      case 'IDLE': this.timer -= dt; if (this.timer <= 0) this.trigger(); break;
      case 'INBOUND': {
        const remain = this.pathLen - this.s;
        const vT = Math.max(3, Math.min(65, Math.sqrt(2 * 1.0 * Math.max(0, remain - 10))));
        const acc = THREE.MathUtils.clamp((vT - this.v), -1.6, 1.2);
        this.v += acc * dt; this.s += this.v * dt;
        const u = Math.min(1, this.s / this.pathLen);
        this.pos.copy(this.path.getPointAt(u));
        tmp.copy(this.path.getTangentAt(u));
        let yawT = headingOf(tmp.x, tmp.z);
        if (remain < 250) yawT = angLerp(yawT, this.landYaw, 1 - remain / 250);
        this.yaw = angLerp(this.yaw, yawT, Math.min(1, dt * 1.2));
        const yawRate = (this.yaw - this.prevYaw) / Math.max(dt, 1e-3);
        pitchT = THREE.MathUtils.clamp(-acc * 0.1, -0.12, 0.2) + (this.v > 20 ? -0.06 : 0);
        rollT = THREE.MathUtils.clamp(yawRate * this.v * 0.02, -0.45, 0.45);
        if (u >= 1) { this.state = 'HOVER'; this.timer = 0; this.ctx.events.emit('log', '[HELI] Hovering over the HS-LQ helideck.'); }
        break;
      }
      case 'HOVER':
        this.timer += dt;
        this.yaw = angLerp(this.yaw, this.landYaw, Math.min(1, dt * 1.5));
        this.pos.set(d.x + Math.sin(t * 0.7) * 0.4, d.y + 15 + Math.sin(t * 1.1) * 0.3, d.z + Math.cos(t * 0.6) * 0.4);
        rollT = Math.sin(t * 0.9) * 0.02; pitchT = 0.03;
        if (this.timer > 5) { this.state = 'LANDING'; this.timer = 0; }
        break;
      case 'LANDING': {
        this.timer += dt;
        const k = smooth(Math.min(1, this.timer / 9));
        this.pos.set(d.x, d.y + 15 * (1 - k), d.z);
        if (k >= 1) { this.state = 'ONDECK'; this.timer = 0; this.ctx.events.emit('log', '[HELI] Touchdown on HS-LQ. Rotors running, crew change under way.'); this.ctx.events.emit('sound', { id: 'heli_touchdown', at: this.pos }); this.ctx.events.emit('sound', { id: 'heli_spool_down', at: this.pos.clone(), vol: 0.7 }); this.startCrew(); }
        break;
      }
      case 'ONDECK':
        this.timer += dt;
        this.pos.set(d.x, d.y - 0.03, d.z);
        this.updateCrew(dt, t);
        if (this.timer > L.helicopterTurnaroundSeconds) { this.state = 'LIFTOFF'; this.timer = 0; this.endCrew(); this.ctx.events.emit('log', '[HELI] Lifting off from HS-LQ.'); this.ctx.events.emit('sound', { id: 'heli_spool_up', at: this.pos.clone(), vol: 0.8 }); }
        break;
      case 'LIFTOFF': {
        this.timer += dt;
        const k = smooth(Math.min(1, this.timer / 7));
        this.pos.set(d.x, d.y + 22 * k, d.z);
        pitchT = 0.02;
        if (k >= 1) {
          this.state = 'OUTBOUND'; this.timer = 0; this.v = 2;
          const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
          const a = this.pos.clone(), b = a.clone().addScaledVector(fwd, 600).setY(a.y + 60);
          const shore = new THREE.Vector3(CONFIG.heliSpawn.x, 0, CONFIG.heliSpawn.z).normalize();
          const c = b.clone().addScaledVector(fwd, 600).addScaledVector(shore, 900).setY(260);
          const e = shore.clone().multiplyScalar(6500).setY(420);
          this.path = new THREE.CatmullRomCurve3([a, b, c, e]); this.pathLen = this.path.getLength(); this.s = 0;
        }
        break;
      }
      case 'OUTBOUND': {
        const acc = this.v < 65 ? 1.4 : 0;
        this.v = Math.min(65, this.v + acc * dt); this.s += this.v * dt;
        const u = Math.min(1, this.s / this.pathLen);
        this.pos.copy(this.path.getPointAt(u)); tmp.copy(this.path.getTangentAt(u));
        this.yaw = angLerp(this.yaw, headingOf(tmp.x, tmp.z), Math.min(1, dt * 0.9));
        const yawRate = (this.yaw - this.prevYaw) / Math.max(dt, 1e-3);
        pitchT = -0.12 * (acc > 0 ? 1 : 0.5); rollT = THREE.MathUtils.clamp(yawRate * this.v * 0.02, -0.45, 0.45);
        if (u >= 1) { this.state = 'IDLE'; this.timer = L.helicopterIdleSeconds; this.root.visible = false; this.rpm = 0; this.ctx.events.emit('log', '[HELI] Helicopter clear of the field, returning to shore.'); }
        break;
      }
    }
    this.prevYaw = this.yaw;
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 1.5);
    this.roll += (rollT - this.roll) * Math.min(1, dt * 1.5);
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    // rotors: blades when slow, blurred discs when fast
    const rpmT = this.state === 'IDLE' ? 0 : this.state === 'ONDECK' && this.timer < this.ctx.settings.logistics.helicopterTurnaroundSeconds - 8 ? 0.62 : 1;   // ground idle during the crew change
    this.rpm += (rpmT - this.rpm) * Math.min(1, dt * 0.4);
    if (this.mainRotor) this.mainRotor.rotation.y += dt * 31 * this.rpm * (this.rpm > 0.7 ? 0.11 : 1);
    if (this.tailRotor) this.tailRotor.rotation.x += dt * 140 * this.rpm * (this.rpm > 0.7 ? 0.07 : 1);
    if (this.disc) { this.disc.visible = this.rpm > 0.5; this.disc.rotation.y += dt * 9; }
    if (this.tailDisc) this.tailDisc.visible = this.rpm > 0.5;
    if (this.mainRotor) this.mainRotor.traverse((o) => { if (o.isMesh) o.visible = this.rpm < 0.85 || (t * 30 % 1) < 0.5; });
    const strobe = Math.sin(t * 9) > 0.85;
    for (const s of this.strobes) s.visible = strobe || this.ctx.night < 0.5;
    this.landLight.intensity = this.root.visible && this.ctx.night > 0.3 && this.state !== 'OUTBOUND' ? 2500 : 0;
  }

  foamSpots(waves, t) {
    if (!this.root.visible) return [];
    const h = this.pos.y - waves.heightAt(this.pos.x, this.pos.z, t);
    if (h > 45) return [];
    const overDeck = Math.hypot(this.pos.x - this.deck.x, this.pos.z - this.deck.z) < 15;
    if (overDeck) return [];
    return [[this.pos.x, this.pos.z, 16, (1 - h / 45) * 1.2]];
  }

  // crew walking between the helicopter door and the helideck stairs
  startCrew() {
    const d = this.deck;
    const door = new THREE.Vector3(1.6, 0, -1.7).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(d);
    const stairs = new THREE.Vector3(CONFIG.lq.x + 2.0, d.y, CONFIG.lq.z + 2.0);
    this.crew.forEach((c, i) => {
      const out = i < 2;
      c.from = out ? door.clone() : stairs.clone(); c.to = out ? stairs.clone() : door.clone();
      c.delay = 6 + (i % 2) * 2.5 + (out ? 0 : 14);
      c.obj.visible = false; c.done = false;
      c.obj.position.copy(c.from);
    });
  }
  updateCrew(dt, t) {
    for (const c of this.crew) {
      if (c.done) continue;
      c.delay -= dt;
      if (c.delay > 0) continue;
      c.obj.visible = true;
      tmp2.subVectors(c.to, c.obj.position); const dist = tmp2.length();
      if (dist < 0.3) { c.obj.visible = false; c.done = true; continue; }
      tmp2.normalize(); c.obj.position.addScaledVector(tmp2, Math.min(dist, 1.3 * dt));
      c.obj.rotation.y = headingOf(tmp2.x, tmp2.z);
      const sw = Math.sin(t * 7 + c.delay) * 0.5;
      if (c.legs[0]) { c.legs[0].rotation.x = sw; c.legs[1].rotation.x = -sw; }
      if (c.arms[0]) { c.arms[0].rotation.x = -sw * 0.7; c.arms[1].rotation.x = sw * 0.7; }
    }
  }
  endCrew() { for (const c of this.crew) c.obj.visible = false; }
}
