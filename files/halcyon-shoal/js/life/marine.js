// Marine life and birds. Bodies bend with a travelling wave in the vertex shader
// (side-to-side for fish and sharks, up-and-down for the whale).
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { findNode, bakedMeshes, flatten } from '../core/assets.js';
import { patchMaterial } from '../core/materials.js';
import { softSprite } from '../core/noise.js';
import { mulberry } from '../env/seabed.js';

const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(1, 1, 1), tmpM = new THREE.Matrix4();
const headingOf = (dx, dz) => Math.atan2(-dx, -dz);

// Body-wave patch. axis: 'x' lateral (fish), 'y' vertical (whale). len: body length; amp: tail amplitude.
function bodyWave(mat, opts) {
  const m = mat.clone();
  patchMaterial(m, { caustic: true });
  const base = m.onBeforeCompile;
  const u = { uWaveT: { value: 0 }, uWaveAmp: { value: opts.amp }, uWaveK: { value: opts.k }, uWaveSpeed: { value: opts.speed || 1 } };
  m.userData.wave = u;
  m.onBeforeCompile = (sh, r) => {
    base(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform float uWaveT; uniform float uWaveAmp; uniform float uWaveK; uniform float uWaveSpeed;\n' + (opts.instanced ? 'attribute float aPhase;\n' : '') +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float wPh = ${opts.instanced ? 'aPhase' : '0.0'};
        float wT = clamp((transformed.z - (${opts.head.toFixed(3)})) / (${(opts.tail - opts.head).toFixed(3)}), 0.0, 1.0);
        float wAmp = uWaveAmp * (0.15 + wT * wT * 1.6);
        float wS = sin(transformed.z * uWaveK - uWaveT * uWaveSpeed * 6.0 + wPh * 6.2831);
        transformed.${opts.axis} += wS * wAmp;`);
  };
  const k0 = m.customProgramCacheKey;
  m.customProgramCacheKey = () => k0() + ':wave' + opts.axis + (opts.instanced ? 'i' : '');
  return m;
}

function meshesOf(root) { const out = []; root.updateMatrixWorld(true); root.traverse((o) => { if (o.isMesh) out.push(o); }); return out; }

export class Marine {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.schools = []; this.residents = []; this.turtles = [];
    this.sightings = { whaleshark: null, whale: null };
    this.time = 0;
  }

  async build() {
    const { assets, quality } = this.ctx;
    const fish = await assets.get('fish');
    const total = quality.tier.fish;
    // schools: scad (many, small), trevally, barracuda
    const plan = [['fish_scad', Math.round(total * 0.55), 3], ['fish_trevally', Math.round(total * 0.3), 2], ['fish_barracuda', Math.max(12, Math.round(total * 0.15)), 1]];
    const rnd = mulberry(77);
    for (const [name, count, nSchools] of plan) {
      const node = findNode(fish.scene, name); if (!node) continue;
      const parts = bakedMeshes(node);
      const per = Math.max(6, Math.floor(count / nSchools));
      for (let s = 0; s < nSchools; s++) {
        const k = this.schools.length % 3;
        const around = k === 0 ? new THREE.Vector3(-22, 0, 30) : k === 1 ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(CONFIG.lq.x, 0, CONFIG.lq.z);
        const school = { fish: [], meshes: [], center: new THREE.Vector3(), angle: rnd() * 6.28, radius: k === 0 ? 9 + rnd() * 8 : 20 + rnd() * 30, depth: k === 0 ? -10 - rnd() * 8 : -6 - rnd() * 24, speed: 0.06 + rnd() * 0.06, dir: rnd() < 0.5 ? 1 : -1, around };
        for (const p of parts) {
          const geo = p.geometry.clone();
          const ph = new Float32Array(per); for (let i = 0; i < per; i++) ph[i] = rnd();
          geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
          geo.computeBoundingBox();
          const bb = geo.boundingBox;
          const mat = bodyWave(p.material, { axis: 'x', head: bb.min.z, tail: bb.max.z, amp: (bb.max.z - bb.min.z) * 0.06, k: 9 / (bb.max.z - bb.min.z), speed: 2.2, instanced: true });
          const im = new THREE.InstancedMesh(geo, mat, per); im.frustumCulled = false; im.castShadow = false;
          school.meshes.push(im); this.group.add(im);
        }
        for (let i = 0; i < per; i++) {
          const slot = new THREE.Vector3((rnd() - 0.5) * 9, (rnd() - 0.5) * 4, (rnd() - 0.5) * 9);
          school.fish.push({ slot, pos: new THREE.Vector3(), vel: new THREE.Vector3(), ph: rnd() * 6.28, scale: 0.8 + rnd() * 0.45 });
        }
        this.schools.push(school);
      }
    }
    // resident groupers by the CPP jacket legs
    const grouper = findNode(fish.scene, 'fish_grouper');
    if (grouper) {
      for (let i = 0; i < 7; i++) {
        const g = grouper.clone(true); g.position.set(0, 0, 0); g.updateMatrixWorld(true);
        flatten(g).forEach((m) => { m.material = bodyWave(m.material, { axis: 'x', head: -0.45, tail: 0.45, amp: 0.035, k: 7, speed: 0.6 }); });
        const legs = this.ctx.field.cppLegs;
        const [lx, lz] = legs[i % legs.length];
        g.userData = { home: new THREE.Vector3(lx * 0.95, -12 - rnd() * 25, lz * 0.95), ph: rnd() * 6.28 };
        g.scale.setScalar(0.9 + rnd() * 0.5);
        this.group.add(g); this.residents.push(g);
      }
    }
    // turtles
    const turtle = await assets.get('turtle');
    for (let i = 0; i < 3; i++) {
      const t = turtle.scene.clone(true);
      t.userData = { angle: i * 2.1, radius: 30 + i * 25, depth: -10 - i * 6, ph: i, nextBreath: 30 + i * 25, breathing: 0,
        fl: findNode(t, 'flipper_l'), fr: findNode(t, 'flipper_r'), hl: findNode(t, 'hind_l'), hr: findNode(t, 'hind_r') };
      t.scale.setScalar(1.0 + i * 0.15);
      this.group.add(t); this.turtles.push(t);
    }
    // whale shark and whale (hidden until a sighting)
    const ws = await assets.get('whaleshark');
    this.whaleshark = ws.scene.clone(true);
    flatten(this.whaleshark).forEach((m) => { m.material = bodyWave(m.material, { axis: 'x', head: -4.6, tail: 5.9, amp: 0.32, k: 0.7, speed: 0.35 }); });
    this.whaleshark.visible = false; this.group.add(this.whaleshark);
    const wh = await assets.get('whale');
    this.whale = wh.scene.clone(true);
    flatten(this.whale).forEach((m) => { m.material = bodyWave(m.material, { axis: 'y', head: -6.8, tail: 7.7, amp: 0.38, k: 0.42, speed: 0.3 }); });
    this.whale.visible = false; this.group.add(this.whale);
    this.blowhole = findNode(this.whale, 'blowhole');
    this.blow = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(240 * 3), 3)),
      new THREE.PointsMaterial({ size: 0.9, map: softSprite(32), color: 0xf2f6f8, transparent: true, opacity: 0, depthWrite: false }));
    this.blow.frustumCulled = false; this.ctx.scene.add(this.blow);
    this.blowSeeds = Array.from({ length: 240 }, () => [Math.random(), Math.random(), Math.random()]);
    this.blowT = -1;
    this.buildJellies();
    await this.buildBirds();
  }

  buildJellies() {
    this.jellies = [];
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.35, roughness: 0.1, transmission: 0, depthWrite: false, side: THREE.DoubleSide, emissive: 0x335566, emissiveIntensity: 0.2 });
    const geo = new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const rnd = mulberry(4);
    for (let i = 0; i < 18; i++) {
      const j = new THREE.Mesh(geo, mat); j.userData = { o: new THREE.Vector3((rnd() - 0.5) * 36, (rnd() - 0.5) * 16, (rnd() - 0.5) * 36), ph: rnd() * 6.28 };
      this.group.add(j); this.jellies.push(j);
    }
  }

  async buildBirds() {
    const gull = await this.ctx.assets.get('gull');
    this.birds = [];
    const n = this.ctx.quality.tier.birds;
    const rnd = mulberry(31);
    for (let i = 0; i < n; i++) {
      const g = gull.scene.clone(true);
      g.userData = { wl: findNode(g, 'wing_l'), wr: findNode(g, 'wing_r'), c: i % 3 === 2 ? new THREE.Vector3(CONFIG.lq.x, 0, CONFIG.lq.z) : new THREE.Vector3(0, 0, 0),
        r: 40 + rnd() * 90, h: 25 + rnd() * 50, sp: (0.12 + rnd() * 0.12) * (rnd() < 0.5 ? 1 : -1), a: rnd() * 6.28, ph: rnd() * 6.28 };
      g.scale.setScalar(1.6);
      this.ctx.scene.add(g); this.birds.push(g);
    }
  }

  // ---------------------------------------------------------------- sightings
  spawnWhaleShark() {
    if (this.sightings.whaleshark) return false;
    const cam = this.ctx.camera.position;
    const under = this.ctx.underwater.active;
    const c = under ? new THREE.Vector3(cam.x, 0, cam.z) : new THREE.Vector3(30, 0, 40);
    const a = Math.random() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(under ? 9 : 14);
    const y = under ? Math.min(-3, cam.y + 1) : -1.6;
    const path = new THREE.CatmullRomCurve3([c.clone().addScaledVector(dir, -40).add(side).setY(y - 1), c.clone().addScaledVector(dir, -12).add(side).setY(y), c.clone().addScaledVector(dir, 14).add(side).setY(y + 0.4), c.clone().addScaledVector(dir, 60).setY(y - 2), c.clone().addScaledVector(dir, 110).setY(y - 5)]);
    this.sightings.whaleshark = { path, s: 0, len: path.getLength(), speed: 1.2 };
    this.whaleshark.visible = true;
    this.ctx.events.emit('alert', { text: 'Sighting: whale shark feeding near the platforms', tone: 'cyan', follow: 'whaleshark' });
    this.ctx.events.emit('log', '[MARINE] Whale shark sighted near the jackets, feeding at the surface.');
    return true;
  }

  spawnWhale() {
    if (this.sightings.whale) return false;
    const a = Math.random() * Math.PI * 2, r = 260;
    const c = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const dir = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push(c.clone().addScaledVector(dir, (i - 4) * 120).addScaledVector(c.clone().normalize(), Math.sin(i) * 40).setY(-14));
    const path = new THREE.CatmullRomCurve3(pts);
    this.sightings.whale = { path, s: 0, len: path.getLength(), speed: 2.4, surf: 0 };
    this.whale.visible = true;
    this.ctx.events.emit('alert', { text: "Rare sighting: Bryde's whale surfacing near the field", tone: 'indigo', follow: 'whale' });
    this.ctx.events.emit('log', "[MARINE] Bryde's whale sighted about 300 m from HS-CPP.");
    return true;
  }

  target(name) { return name === 'whale' ? this.whale : this.whaleshark; }

  // ---------------------------------------------------------------- update
  update(dt, t, waves) {
    this.time = t;
    const under = this.ctx.underwater.active;
    const cam = this.ctx.camera.position;
    const nearField = Math.hypot(cam.x, cam.z) < 600;
    const doFish = under || (nearField && cam.y < 80);
    for (const sc of this.schools) for (const m of sc.meshes) { m.visible = doFish; m.material.userData.wave.uWaveT.value = t; }
    if (doFish) this.updateSchools(dt, t);
    for (const g of this.residents) {
      g.visible = under; if (!under) continue;
      const u = g.userData;
      g.position.set(u.home.x + Math.sin(t * 0.08 + u.ph) * 3, u.home.y + Math.sin(t * 0.3 + u.ph) * 0.6, u.home.z + Math.cos(t * 0.07 + u.ph) * 3);
      g.rotation.y = headingOf(Math.cos(t * 0.08 + u.ph), -Math.sin(t * 0.07 + u.ph));
      g.traverse((o) => { if (o.isMesh) o.material.userData.wave.uWaveT.value = t; });
    }
    for (const tu of this.turtles) this.updateTurtle(tu, dt, t, waves);
    this.updateBigOnes(dt, t, waves);
    for (const j of this.jellies) {
      j.visible = under; if (!under) continue;
      const u = j.userData;
      u.o.y += dt * 0.08 * (0.5 + Math.sin(t * 1.4 + u.ph) * 0.5);
      if (u.o.y > 8) u.o.y = -8;
      const wrap = (v, h) => (((v + h) % (2 * h)) + 2 * h) % (2 * h) - h;
      j.position.set(cam.x + wrap(u.o.x - cam.x * 0, 18), Math.min(-1, cam.y + u.o.y), cam.z + wrap(u.o.z, 18));
      const p = 1 + Math.sin(t * 2.4 + u.ph) * 0.18; j.scale.set(p, 1 / p, p);
    }
    for (const b of this.birds) {
      const u = b.userData;
      u.a += u.sp * dt;
      const x = u.c.x + Math.cos(u.a) * u.r, z = u.c.z + Math.sin(u.a) * u.r, y = u.h + Math.sin(t * 0.4 + u.ph) * 6;
      const nx = u.c.x + Math.cos(u.a + u.sp * 0.1) * u.r, nz = u.c.z + Math.sin(u.a + u.sp * 0.1) * u.r;
      b.position.set(x, y, z);
      b.rotation.set(0, headingOf(nx - x, nz - z), -Math.sign(u.sp) * 0.35, 'YXZ');
      const flap = Math.sin(t * 6 + u.ph) > -0.2 && Math.sin(t * 0.35 + u.ph) > 0 ? Math.sin(t * 9 + u.ph) * 0.6 : 0.08;
      if (u.wl) { u.wl.rotation.z = -flap; u.wr.rotation.z = flap; }
      b.visible = !under;
    }
  }

  updateSchools(dt, t) {
    const cam = this.ctx.camera.position;
    const shark = this.sightings.whaleshark ? this.whaleshark.position : null;
    for (const sc of this.schools) {
      sc.angle += dt * sc.speed * sc.dir;
      sc.center.set(sc.around.x + Math.cos(sc.angle) * sc.radius, sc.depth + Math.sin(t * 0.2 + sc.radius) * 2, sc.around.z + Math.sin(sc.angle) * sc.radius);
      const fwd = tmpV.set(-Math.sin(sc.angle) * sc.dir, 0, Math.cos(sc.angle) * sc.dir);
      const yaw = Math.atan2(fwd.x, fwd.z);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      sc.fish.forEach((f, i) => {
        const sl = f.slot;
        const tx = sc.center.x + sl.x * cy + sl.z * sy + Math.sin(t * 0.7 + f.ph) * 0.8;
        const ty = sc.center.y + sl.y + Math.sin(t * 0.9 + f.ph) * 0.3;
        const tz = sc.center.z - sl.x * sy + sl.z * cy + Math.cos(t * 0.6 + f.ph) * 0.8;
        let ax = (tx - f.pos.x) * 0.9 - f.vel.x * 1.2, ay = (ty - f.pos.y) * 0.9 - f.vel.y * 1.2, az = (tz - f.pos.z) * 0.9 - f.vel.z * 1.2;
        for (const threat of [cam, shark]) {
          if (!threat) continue;
          const dx = f.pos.x - threat.x, dy = f.pos.y - threat.y, dz = f.pos.z - threat.z, d2 = dx * dx + dy * dy + dz * dz;
          const r = threat === cam ? 5 : 9;
          if (d2 < r * r) { const k = (r * r - d2) / (r * r) * 30 / Math.sqrt(d2 + 0.01); ax += dx * k; ay += dy * k * 0.5; az += dz * k; }
        }
        f.vel.x += ax * dt; f.vel.y += ay * dt; f.vel.z += az * dt;
        if (f.pos.lengthSq() === 0) f.pos.set(tx, ty, tz);
        f.pos.addScaledVector(f.vel, dt);
        const sp = Math.hypot(f.vel.x, f.vel.z) + 0.3;
        tmpQ.setFromEuler(new THREE.Euler(-f.vel.y * 0.2, headingOf(f.vel.x + fwd.x * 0.3, f.vel.z + fwd.z * 0.3), 0, 'YXZ'));
        tmpS.setScalar(f.scale);
        tmpM.compose(f.pos, tmpQ, tmpS);
        for (const m of sc.meshes) m.setMatrixAt(i, tmpM);
      });
      for (const m of sc.meshes) m.instanceMatrix.needsUpdate = true;
    }
  }

  updateTurtle(tu, dt, t, waves) {
    const u = tu.userData;
    u.angle -= dt * 0.035;
    u.nextBreath -= dt;
    let y = u.depth + Math.sin(t * 0.2 + u.ph) * 1.5;
    if (u.nextBreath < 0) {        // rise to breathe, pause at the surface, dive again
      u.breathing += dt;
      const k = u.breathing < 15 ? u.breathing / 15 : u.breathing < 25 ? 1 : Math.max(0, 1 - (u.breathing - 25) / 15);
      y = THREE.MathUtils.lerp(y, waves.heightAt(tu.position.x, tu.position.z, t) - 0.2, k * k * (3 - 2 * k));
      if (u.breathing > 40) { u.breathing = 0; u.nextBreath = 60 + Math.random() * 60; }
    }
    const x = Math.cos(u.angle) * u.radius, z = Math.sin(u.angle) * u.radius;
    const nx = Math.cos(u.angle - 0.05) * u.radius, nz = Math.sin(u.angle - 0.05) * u.radius;
    tu.position.set(x, y, z);
    tu.rotation.set(0, headingOf(nx - x, nz - z), 0);
    const flap = Math.sin(t * 1.6 + u.ph);
    if (u.fl) { u.fl.rotation.z = flap * 0.5; u.fr.rotation.z = -flap * 0.5; u.fl.rotation.y = flap * 0.2; u.fr.rotation.y = -flap * 0.2; }
    if (u.hl) { u.hl.rotation.z = flap * 0.2; u.hr.rotation.z = -flap * 0.2; }
  }

  updateBigOnes(dt, t, waves) {
    const s = this.sightings;
    this.whaleshark.traverse((o) => { if (o.isMesh) o.material.userData.wave.uWaveT.value = t; });
    this.whale.traverse((o) => { if (o.isMesh) o.material.userData.wave.uWaveT.value = t; });
    if (s.whaleshark) {
      const w = s.whaleshark; w.s += w.speed * dt;
      const u = Math.min(1, w.s / w.len);
      w.path.getPointAt(u, this.whaleshark.position);
      const tg = w.path.getTangentAt(Math.min(0.999, u));
      this.whaleshark.rotation.set(tg.y * 0.6, headingOf(tg.x, tg.z), 0, 'YXZ');
      if (u >= 1) { s.whaleshark = null; this.whaleshark.visible = false; }
    }
    if (s.whale) {
      const w = s.whale; w.s += w.speed * dt;
      const u = Math.min(1, w.s / w.len);
      const p = w.path.getPointAt(u);
      // surfacing cycle every ~70 s: back and dorsal fin break the surface, then a blow
      const cyc = (w.s / w.speed) % 70;
      const surf = cyc > 40 && cyc < 58 ? Math.sin((cyc - 40) / 18 * Math.PI) : 0;
      p.y = THREE.MathUtils.lerp(-14, waves.heightAt(p.x, p.z, t) - 0.6, surf);
      this.whale.position.copy(p);
      const tg = w.path.getTangentAt(Math.min(0.999, u));
      const pitch = cyc > 40 && cyc < 58 ? Math.cos((cyc - 40) / 18 * Math.PI) * 0.12 : 0;
      this.whale.rotation.set(pitch, headingOf(tg.x, tg.z), 0, 'YXZ');
      if (surf > 0.95 && this.blowT < 0) { this.blowT = 0; this.ctx.events.emit('log', "[MARINE] Bryde's whale surfaced and blew."); }
      if (cyc < 1 && !w.called) { w.called = true; this.ctx.events.emit('sound', { id: 'uw_whale_call', at: p.clone() }); } else if (cyc > 2) w.called = false;
      if (u >= 1) { s.whale = null; this.whale.visible = false; }
    }
    // blow spray
    if (this.blowT >= 0 && this.blowhole) {
      this.blowT += dt;
      const o = new THREE.Vector3(); this.blowhole.getWorldPosition(o);
      const pos = this.blow.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const [a, b, c] = this.blowSeeds[i];
        const k = Math.min(1, this.blowT * (0.8 + a * 0.6));
        pos.setXYZ(i, o.x + (b - 0.5) * 2.2 * k, o.y + k * (3.5 + a * 2.5) - k * k * 1.2, o.z + (c - 0.5) * 2.2 * k);
      }
      pos.needsUpdate = true;
      this.blow.material.opacity = Math.max(0, 0.7 * (1 - this.blowT / 4));
      if (this.blowT > 4) { this.blowT = -1; this.blow.material.opacity = 0; }
    }
  }
}
