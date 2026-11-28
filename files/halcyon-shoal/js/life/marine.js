// Marine life and birds. Bodies bend with a travelling wave in the vertex shader
// (side-to-side for fish and sharks, up-and-down for the whale).
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { findNode, bakedMeshes, flatten } from '../core/assets.js';
import { patchMaterial } from '../core/materials.js';
import { softSprite } from '../core/noise.js';
import { mulberry } from '../env/seabed.js';
import { PathAgent } from '../sim/obstacles.js';

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
    this.sightings = { whaleshark: null, whale: null, dolphins: null, flyingfish: null };
    this.podCentre = new THREE.Object3D();
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
        // legs batter outward with depth (1 in 10); groupers hold station ~3.5 m outside the leg
        const y = -12 - rnd() * 25, bx = Math.sign(lx) * -y * 0.1, bz = Math.sign(lz) * -y * 0.1;
        const out = new THREE.Vector3(lx, 0, lz).normalize();
        const leg = new THREE.Vector3(lx + bx, y, lz + bz);
        g.userData = { home: leg.clone().addScaledVector(out, 3.5), leg, ph: rnd() * 6.28 };
        g.scale.setScalar(0.9 + rnd() * 0.5);
        this.group.add(g); this.residents.push(g);
      }
    }
    // turtles
    const turtle = await assets.get('turtle');
    for (let i = 0; i < 3; i++) {
      const t = turtle.scene.clone(true);
      t.userData = { angle: i * 2.1, radius: 50 + i * 25, depth: -10 - i * 6, ph: i, nextBreath: 30 + i * 25, breathing: 0,
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
    await this.buildDolphins();
    await this.buildFlyingFish();
    this.perchModel = (await this.ctx.assets.get('gull_perched')).scene;
    this.buildPerchedGulls();
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
    this.gullModel = gull.scene;
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
    this.sightings.whaleshark = { path, s: 0, len: path.getLength(), speed: 1.2, agent: new PathAgent(this.ctx.obstacles, path, { radius: 4, lead: 14, turn: 0.45, opt: { self: 'whaleshark', look: 26, margin: 8 } }) };
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
    this.sightings.whale = { path, s: 0, len: path.getLength(), speed: 2.4, surf: 0, t: 0, agent: new PathAgent(this.ctx.obstacles, path, { radius: 6, lead: 40, turn: 0.22, opt: { self: 'whale', look: 70, margin: 15 } }) };
    this.whale.visible = true;
    this.ctx.events.emit('alert', { text: "Rare sighting: Bryde's whale surfacing near the field", tone: 'indigo', follow: 'whale' });
    this.ctx.events.emit('log', "[MARINE] Bryde's whale sighted about 300 m from HS-CPP.");
    return true;
  }

  target(name) { return name === 'whale' ? this.whale : name === 'dolphins' ? this.podCentre : this.whaleshark; }

  // ---------------------------------------------------------------- update
  update(dt, t, waves) {
    this.time = t;
    this.splashes = this.ctx.splashes;
    const under = this.ctx.underwater.active;
    const cam = this.ctx.camera.position;
    const nearField = Math.hypot(cam.x, cam.z) < 600;
    const doFish = under || (nearField && cam.y < 80);
    for (const sc of this.schools) for (const m of sc.meshes) { m.visible = doFish; m.material.userData.wave.uWaveT.value = t; }
    if (doFish) this.updateSchools(dt, t);
    for (const g of this.residents) {
      g.visible = under; if (!under) continue;
      const u = g.userData;
      g.position.set(u.home.x + Math.sin(t * 0.08 + u.ph) * 1.4, u.home.y + Math.sin(t * 0.3 + u.ph) * 0.6, u.home.z + Math.cos(t * 0.07 + u.ph) * 1.4);
      const dx = g.position.x - u.leg.x, dz = g.position.z - u.leg.z, d = Math.hypot(dx, dz);   // never inside the leg
      if (d < 2.4) { g.position.x = u.leg.x + dx / d * 2.4; g.position.z = u.leg.z + dz / d * 2.4; }
      g.rotation.y = headingOf(Math.cos(t * 0.08 + u.ph) * 1.4, -Math.sin(t * 0.07 + u.ph) * 1.4);
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
      b.visible = !under && !this.isNight;
    }
    this.updatePerched(dt, t);
    this.updateDolphins(dt, t, waves);
    this.updateFlyingFish(dt, t, waves);
  }

  get isNight() { return this.ctx.sky.presetName === 'night'; }

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
    if (!u.agent) {
      u.agent = new PathAgent(this.ctx.obstacles, new THREE.LineCurve3(new THREE.Vector3(Math.cos(u.angle) * u.radius, u.depth, Math.sin(u.angle) * u.radius), new THREE.Vector3(Math.cos(u.angle - 0.1) * u.radius, u.depth, Math.sin(u.angle - 0.1) * u.radius)), { radius: 1.5, turn: 0.5, opt: { self: 'turtle', look: 14, margin: 6 } });
    }
    u.angle -= dt * 0.35 / u.radius * 6;
    u.nextBreath -= dt;
    let y = u.depth + Math.sin(t * 0.2 + u.ph) * 1.5;
    const a = u.agent;
    if (u.nextBreath < 0) {        // rise to breathe, pause at the surface, dive again
      u.breathing += dt;
      const k = u.breathing < 15 ? u.breathing / 15 : u.breathing < 25 ? 1 : Math.max(0, 1 - (u.breathing - 25) / 15);
      y = THREE.MathUtils.lerp(y, waves.heightAt(a.pos.x, a.pos.z, t) - 0.2, k * k * (3 - 2 * k));
      if (u.breathing > 40) { u.breathing = 0; u.nextBreath = 60 + Math.random() * 60; }
    }
    // swim toward a point a little ahead on the orbit, steering round jackets and other animals
    const carrot = new THREE.Vector3(Math.cos(u.angle - 0.25) * u.radius, y, Math.sin(u.angle - 0.25) * u.radius);
    a.seek(dt, 0.45, carrot, false);
    a.pos.y = Math.max(y, this.floorAt(a.pos.x, a.pos.z) + 1.2);
    tu.position.copy(a.pos);
    tu.rotation.set(0, a.heading, 0);
    const flap = Math.sin(t * 1.6 + u.ph);
    if (u.fl) { u.fl.rotation.z = flap * 0.5; u.fr.rotation.z = -flap * 0.5; u.fl.rotation.y = flap * 0.2; u.fr.rotation.y = -flap * 0.2; }
    if (u.hl) { u.hl.rotation.z = flap * 0.2; u.hr.rotation.z = -flap * 0.2; }
  }

  floorAt(x, z) { return this.ctx.seabed && this.ctx.seabed.heightAt ? this.ctx.seabed.heightAt(x, z) : -45; }

  // spheres other agents (and the vessel) steer round
  spheres() {
    const out = [];
    if (this.sightings.whale) { const p = this.whale.position; out.push({ x: p.x, y: p.y, z: p.z, r: 6, owner: 'whale' }); }
    if (this.sightings.whaleshark) { const p = this.whaleshark.position; out.push({ x: p.x, y: p.y, z: p.z, r: 4, owner: 'whaleshark' }); }
    if (this.sightings.dolphins) { const p = this.podCentre.position; out.push({ x: p.x, y: -2, z: p.z, r: 5, owner: 'dolphins' }); }
    return out;
  }

  updateBigOnes(dt, t, waves) {
    const s = this.sightings;
    this.whaleshark.traverse((o) => { if (o.isMesh) o.material.userData.wave.uWaveT.value = t; });
    this.whale.traverse((o) => { if (o.isMesh) o.material.userData.wave.uWaveT.value = t; });
    if (s.whaleshark) {
      const w = s.whaleshark, a = w.agent;
      const y0 = a.pos.y;
      a.update(dt, w.speed, true);
      a.pos.y = Math.max(a.pos.y, this.floorAt(a.pos.x, a.pos.z) + 2.5);
      a.pos.y = Math.min(a.pos.y, waves.heightAt(a.pos.x, a.pos.z, t) - 0.9);
      this.whaleshark.position.copy(a.pos);
      const pitch = THREE.MathUtils.clamp((a.pos.y - y0) / Math.max(dt, 1e-3) / w.speed, -0.4, 0.4);
      this.whaleshark.rotation.set(pitch * 0.6, a.heading, 0, 'YXZ');
      if (a.done) { s.whaleshark = null; this.whaleshark.visible = false; }
    }
    if (s.whale) {
      const w = s.whale, a = w.agent;
      w.t += dt;
      // surfacing cycle every ~70 s: back and dorsal fin break the surface, then a blow
      const cyc = w.t % 70;
      const surf = cyc > 40 && cyc < 58 ? Math.sin((cyc - 40) / 18 * Math.PI) : 0;
      a.update(dt, w.speed, false);
      const p = a.pos;
      p.y = THREE.MathUtils.lerp(-14, waves.heightAt(p.x, p.z, t) - 0.6, surf);
      p.y = Math.max(p.y, this.floorAt(p.x, p.z) + 4);
      this.whale.position.copy(p);
      const pitch = cyc > 40 && cyc < 58 ? Math.cos((cyc - 40) / 18 * Math.PI) * 0.12 : 0;
      this.whale.rotation.set(pitch, a.heading, 0, 'YXZ');
      if (surf > 0.95 && this.blowT < 0) { this.blowT = 0; this.ctx.events.emit('log', "[MARINE] Bryde's whale surfaced and blew."); this.ctx.events.emit('sound', { id: 'whale_blow', at: p.clone() }); }
      if (cyc < 1 && !w.called) { w.called = true; this.ctx.events.emit('sound', { id: 'uw_whale_call', at: p.clone() }); } else if (cyc > 2) w.called = false;
      if (a.done) { s.whale = null; this.whale.visible = false; }
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

  // ================================================================ perched gulls on the bridge
  buildPerchedGulls() {
    this.perched = [];
    const src = this.perchModel; if (!src) return;
    const n = { phone: 5, pc: 7, plus: 9 }[this.ctx.quality.tierName] || 7;
    const rnd = mulberry(55);
    const perches = [[33.8, 4.3], [33.8, 7.7], [31.1, 5.05], [31.1, 6.95]];   // top chords and handrails (y, z)
    const used = [];
    const into = () => headingOf(-Math.sin(this.ctx.wind.dir), Math.cos(this.ctx.wind.dir));   // face into the wind
    for (let i = 0; i < n * 4 && this.perched.length < n; i++) {
      const x = -74 + rnd() * 48;
      const [py, pz] = perches[(rnd() * perches.length) | 0];
      if (used.some(([ux, uz]) => Math.abs(ux - x) < 2.2 && Math.abs(uz - pz) < 1)) continue;
      used.push([x, pz]);
      const g = src.clone(true);
      const wl = findNode(g, 'wing_l'), wr = findNode(g, 'wing_r');
      const fold = () => { if (wl) wl.rotation.z = 0; if (wr) wr.rotation.z = 0; };
      fold();
      g.scale.setScalar(1.3);      // a large Gulf gull (Heuglin's / sooty gull size)
      g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g);
      g.position.set(x, py - bb.min.y, pz);
      const yaw0 = into() + (rnd() - 0.5) * 0.9;
      g.rotation.y = yaw0;
      g.userData = { wl, wr, fold, yaw: yaw0, yawT: yaw0, next: 2 + rnd() * 6, stretch: -1, baseY: g.position.y, ph: rnd() * 6.28 };
      this.ctx.scene.add(g); this.perched.push(g);
    }
  }

  updatePerched(dt, t) {
    if (!this.perched) return;
    const cam = this.ctx.camera.position;
    const show = !this.isNight && !this.ctx.underwater.active && Math.hypot(cam.x + 50, cam.z - 6) < 1200 && this.ctx.activeScene === this.ctx.scene;
    for (const g of this.perched) {
      g.visible = show; if (!show) continue;
      const u = g.userData;
      u.next -= dt;
      if (u.next < 0) {
        if (Math.random() < 0.3) u.stretch = 0;                        // wing stretch / short flap
        else u.yawT = u.yaw + (Math.random() - 0.5) * 1.2;            // look around
        u.next = 3 + Math.random() * 7;
      }
      g.rotation.y += (u.yawT - g.rotation.y) * Math.min(1, dt * 3);
      g.position.y = u.baseY;
      if (u.stretch >= 0) {
        u.stretch += dt;
        const k = Math.sin(Math.min(1, u.stretch / 1.8) * Math.PI);
        const f = Math.sin(t * 15 + u.ph) * 0.6 * k;
        // wings lifted out and up about the shoulder, with a few beats at the top
        if (u.wl) u.wl.rotation.z = -(1.35 * k + Math.max(0, f) * 0.4);
        if (u.wr) u.wr.rotation.z = 1.35 * k + Math.max(0, f) * 0.4;
        g.position.y = u.baseY + k * 0.03;
        if (u.stretch > 1.8) { u.stretch = -1; u.fold(); }
      }
    }
  }

  // ================================================================ dolphins
  async buildDolphins() {
    const m = await this.ctx.assets.get('dolphin');
    const n = { phone: 5, pc: 8, plus: 10 }[this.ctx.quality.tierName] || 8;
    this.dolphins = [];
    for (let i = 0; i < n; i++) {
      const d = m.scene.clone(true);
      flatten(d).forEach((o) => { o.material = bodyWave(o.material, { axis: 'y', head: -1.3, tail: 1.5, amp: 0.07, k: 2.2, speed: 1.3 }); o.castShadow = false; });
      d.visible = false;
      d.userData = { slot: new THREE.Vector3((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 16), depth: -1.6 - Math.random() * 2,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, pitch: 0, roll: 0, state: 'swim', st: 0,
        nextBreath: 2 + Math.random() * 10, nextLeap: 6 + Math.random() * 20, leaper: Math.random() < 0.55, ph: Math.random() * 6.28, whistle: 3 + Math.random() * 8 };
      this.group.add(d); this.dolphins.push(d);
    }
  }

  focusPoint(ahead = 80) {
    const cam = this.ctx.camera.position;
    const fwd = new THREE.Vector3(); this.ctx.camera.getWorldDirection(fwd); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); fwd.normalize();
    const inField = Math.hypot(cam.x, cam.z) < 2500;
    const p = inField ? new THREE.Vector3(cam.x, 0, cam.z).addScaledVector(fwd, ahead) : new THREE.Vector3(60, 0, 140);
    return { p, fwd };
  }

  spawnDolphins() {
    if (this.sightings.dolphins || !this.dolphins) return false;
    const { p, fwd } = this.focusPoint(Math.max(60, Math.min(200, this.ctx.camera.position.y * 1.5 + 50)));
    const across = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    const pts = [p.clone().addScaledVector(across, -260).addScaledVector(fwd, 30), p.clone().addScaledVector(across, -90), p.clone().addScaledVector(across, 60).addScaledVector(fwd, -10), p.clone().addScaledVector(across, 380).addScaledVector(fwd, 40)];
    pts.forEach((q) => q.setY(-2));
    const path = new THREE.CatmullRomCurve3(pts);
    const agent = new PathAgent(this.ctx.obstacles, path, { radius: 7, lead: 25, turn: 0.35, opt: { self: 'dolphins', look: 35, margin: 10 } });
    this.sightings.dolphins = { agent, speed: 4.2, ride: 0, t: 0 };
    this.podCentre.position.copy(agent.pos);
    for (const d of this.dolphins) { const u = d.userData; u.pos.copy(agent.pos).add(u.slot).setY(u.depth); u.vel.set(0, 0, 0); u.state = 'swim'; d.visible = true; }
    this.ctx.events.emit('alert', { text: 'Sighting: a pod of bottlenose dolphins', tone: 'cyan', follow: 'dolphins' });
    this.ctx.events.emit('log', `[MARINE] Pod of ${this.dolphins.length} Indo-Pacific bottlenose dolphins passing the field.`);
    return true;
  }

  updateDolphins(dt, t, waves) {
    const pod = this.sightings.dolphins; if (!pod || !this.dolphins) return;
    pod.t += dt;
    const a = pod.agent, v = this.ctx.vessel;
    for (const d of this.dolphins) d.traverse((o) => { if (o.isMesh) o.material.userData.wave.uWaveT.value = t + d.userData.ph; });
    // bow-riding: if the supply vessel is under way nearby, the pod joins its bow wave for a while
    let speed = pod.speed;
    if (v.root.visible && v.speed > 3 && (v.state === 'INBOUND' || v.state === 'OUTBOUND') && pod.ride < 100) {
      const fwd = new THREE.Vector3(-Math.sin(v.heading), 0, -Math.cos(v.heading));
      const bow = v.pos.clone().addScaledVector(fwd, 58);
      if (a.pos.distanceTo(bow) < 400 || pod.ride > 0) {
        if (pod.ride === 0) this.ctx.events.emit('log', '[MARINE] Dolphins riding the bow wave of MV Halcyon Star.');
        pod.ride += dt; speed = Math.min(9, v.speed + (a.pos.distanceTo(bow) > 20 ? 3 : 0.3));
        a.seek(dt, speed, bow, false, { self: 'dolphins', ignore: ['vessel'], look: 20, margin: 4 });
        if (pod.ride >= 100) a.setPath(new THREE.CatmullRomCurve3([a.pos.clone(), a.pos.clone().addScaledVector(a.dir, 200).add(new THREE.Vector3(a.dir.z * 80, 0, -a.dir.x * 80)), a.pos.clone().addScaledVector(a.dir, 450)]), a.pos);
      } else a.update(dt, speed, false);
    } else a.update(dt, speed, false);
    this.podCentre.position.set(a.pos.x, 0, a.pos.z);
    const yaw = a.heading, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const camUnder = this.ctx.underwater.active, cam = this.ctx.camera.position;
    for (const d of this.dolphins) {
      const u = d.userData;
      // horizontal: chase the slot in the pod formation
      const tx = a.pos.x + u.slot.x * cy + u.slot.z * sy + Math.sin(t * 0.3 + u.ph) * 2, tz = a.pos.z - u.slot.x * sy + u.slot.z * cy + Math.cos(t * 0.25 + u.ph) * 2;
      const podV = new THREE.Vector3(a.dir.x * speed, 0, a.dir.z * speed);
      const want = podV.add(new THREE.Vector3((tx - u.pos.x) * 0.5, 0, (tz - u.pos.z) * 0.5));
      if (u.state === 'leap' && u.st > 0.7) want.copy(new THREE.Vector3(-Math.sin(u.heading), 0, -Math.cos(u.heading)).multiplyScalar(u.leapH));
      if (want.length() > 9.5) want.setLength(9.5);
      u.vel.x += (want.x - u.vel.x) * Math.min(1, dt * 1.5); u.vel.z += (want.z - u.vel.z) * Math.min(1, dt * 1.5);
      u.pos.x += u.vel.x * dt; u.pos.z += u.vel.z * dt;
      if (u.state !== 'leap' && Math.hypot(u.vel.x, u.vel.z) > 0.3) u.heading = headingOf(u.vel.x, u.vel.z);
      const surf = waves.heightAt(u.pos.x, u.pos.z, t);
      const base = surf + u.depth + Math.sin(t * 0.6 + u.ph) * 0.3;
      let y = base, pitch = 0;
      u.nextBreath -= dt; u.nextLeap -= dt;
      if (u.state === 'swim') {
        if (u.leaper && u.nextLeap < 0) { u.state = 'leap'; u.st = 0; u.leapH = 5.8; }
        else if (u.nextBreath < 0) { u.state = 'breathe'; u.st = 0; }
      }
      if (u.state === 'breathe') {
        u.st += dt; const k = Math.min(1, u.st / 1.7);
        y = THREE.MathUtils.lerp(base, surf + 0.02, Math.sin(Math.PI * k));
        pitch = Math.cos(Math.PI * k) * 0.4;
        if (!u.blew && k > 0.4) { u.blew = true; this.ctx.events.emit('sound', { id: 'dolphin_blow', at: new THREE.Vector3(u.pos.x, surf, u.pos.z), vol: 0.6 }); this.splashes && this.splashes.emit(new THREE.Vector3(u.pos.x, surf + 0.2, u.pos.z), { n: 6, speed: 0.4, up: 2, size: 0.18, ttl: 0.8, foam: false }); }
        if (k >= 1) { u.state = 'swim'; u.blew = false; u.nextBreath = 8 + Math.random() * 7; }
      } else if (u.state === 'leap') {
        u.st += dt;
        const vy0 = 6.9, y0 = surf - 0.45;
        if (u.st < 0.7) {                     // accelerate and angle up from depth
          const k = u.st / 0.7; y = THREE.MathUtils.lerp(base, y0, k * k); pitch = 0.75 * k;
        } else {
          const tt = u.st - 0.7;
          y = y0 + vy0 * tt - 4.905 * tt * tt;
          pitch = Math.atan2(vy0 - 9.81 * tt, u.leapH);
          u.roll = Math.sin(tt * 2.2) * 0.25;
          if (!u.exited) { u.exited = true; this.splash(u, surf, 0.8); }
          if (tt > 0.4 && y < y0) {
            this.splash(u, surf, 1.4);
            u.state = 'dive'; u.st = 0; u.exited = false; u.roll = 0;
          }
        }
      } else if (u.state === 'dive') {
        u.st += dt; const k = Math.min(1, u.st / 1.2);
        y = THREE.MathUtils.lerp(surf - 0.6, base, k); pitch = -0.7 * (1 - k);
        if (k >= 1) { u.state = 'swim'; u.nextLeap = 10 + Math.random() * 25; u.nextBreath = 5 + Math.random() * 6; }
      }
      u.pitch += (pitch - u.pitch) * Math.min(1, dt * (u.state === 'leap' ? 12 : 4));
      d.position.set(u.pos.x, y, u.pos.z);
      d.rotation.set(u.pitch, u.heading, u.roll, 'YXZ');
      // whistles and clicks when the camera is underwater nearby
      if (camUnder && u.pos.distanceTo(cam) < 70) { u.whistle -= dt; if (u.whistle < 0) { u.whistle = 4 + Math.random() * 8; this.ctx.events.emit('sound', { id: 'dolphin_whistle', at: d.position.clone(), vol: 0.8 }); } }
    }
    if (a.done) { this.sightings.dolphins = null; for (const d of this.dolphins) d.visible = false; this.ctx.events.emit('log', '[MARINE] Dolphin pod has moved on.'); }
  }

  splash(u, surf, power) {
    const p = new THREE.Vector3(u.pos.x, surf + 0.1, u.pos.z);
    if (this.splashes) this.splashes.emit(p, { n: Math.round(26 * power), speed: 1.6 * power, up: 2.4 * power, size: 0.28, ttl: 1.1, foamR: 2.2, foamS: 0.9 });
    if (Math.hypot(p.x - this.ctx.camera.position.x, p.z - this.ctx.camera.position.z) < 400) this.ctx.events.emit('sound', { id: 'dolphin_splash', at: p, vol: Math.min(1, 0.5 * power) });
  }

  // ================================================================ flying fish
  async buildFlyingFish() {
    const m = await this.ctx.assets.get('flyingfish');
    const n = { phone: 40, pc: 80, plus: 120 }[this.ctx.quality.tierName] || 80;
    const node = findNode(m.scene, 'flyingfish') || m.scene;
    const parts = bakedMeshes(node);
    this.ffMeshes = parts.map((p) => { const im = new THREE.InstancedMesh(p.geometry, p.material, n); im.frustumCulled = false; im.castShadow = false; im.visible = false; this.ctx.scene.add(im); return im; });
    this.ff = Array.from({ length: n }, () => ({ pos: new THREE.Vector3(), dir: new THREE.Vector3(), delay: 0, T: 1, h: 1, sp: 15, launched: false, landed: false, start: new THREE.Vector3() }));
  }

  spawnFlyingFish() {
    if (this.sightings.flyingfish || !this.ff) return false;
    const v = this.ctx.vessel;
    let c, dir;
    if (v.root.visible && v.speed > 2 && v.pos.distanceTo(this.ctx.camera.position) < 1200 && Math.random() < 0.6) {
      dir = new THREE.Vector3(-Math.sin(v.heading), 0, -Math.cos(v.heading));
      c = v.pos.clone().addScaledVector(dir, 70);              // startled ahead of the bow
    } else {
      const f = this.focusPoint(Math.max(45, Math.min(140, this.ctx.camera.position.y * 1.2 + 40)));
      c = f.p; dir = new THREE.Vector3(-f.fwd.z, 0, f.fwd.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1).lerp(f.fwd, -0.3).normalize();
    }
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (const f of this.ff) {
      const a = (Math.random() - 0.5) * 0.5;
      f.dir.copy(dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      f.start.copy(c).addScaledVector(side, (Math.random() - 0.5) * 50).addScaledVector(dir, (Math.random() - 0.5) * 24);
      f.delay = Math.pow(Math.random(), 1.6) * 6; f.sp = 13 + Math.random() * 4; f.T = (20 + Math.random() * 40) / f.sp; f.h = 0.5 + Math.random() * 1.0;
      f.launched = false; f.landed = false; f.age = -f.delay;
    }
    this.sightings.flyingfish = { t: 0, sound: 0, centre: c.clone(), dir: dir.clone() };
    for (const m of this.ffMeshes) m.visible = true;
    this.ctx.events.emit('log', '[MARINE] A large shoal of flying fish broke the surface.');
    return true;
  }

  updateFlyingFish(dt, t, waves) {
    const sh = this.sightings.flyingfish; if (!sh) return;
    sh.t += dt; sh.sound -= dt;
    let alive = 0;
    const cam = this.ctx.camera.position;
    this.ff.forEach((f, i) => {
      f.age += dt;
      let visible = false;
      if (f.age >= 0 && !f.landed) {
        const u = f.age / f.T;
        if (u >= 1) {
          f.landed = true;
          const surf = waves.heightAt(f.pos.x, f.pos.z, t);
          this.splashes && this.splashes.emit(f.pos.clone().setY(surf + 0.05), { n: 5, speed: 0.8, up: 1.4, size: 0.12, ttl: 0.6, foam: i % 4 === 0, foamR: 0.8, foamS: 0.6, jitter: 0.2 });
        } else {
          f.pos.copy(f.start).addScaledVector(f.dir, f.sp * f.age);
          const surf = waves.heightAt(f.pos.x, f.pos.z, t);
          const lift = u < 0.12 ? (u / 0.12) * 0.7 : 0.7 + 0.3 * Math.sin(Math.min(1, (u - 0.12) / 0.6) * Math.PI / 2);
          const fall = u > 0.8 ? 1 - Math.pow((u - 0.8) / 0.2, 2) : 1;
          f.pos.y = surf + f.h * lift * fall + 0.05;
          if (!f.launched) {
            f.launched = true;
            this.splashes && this.splashes.emit(f.pos.clone().setY(surf + 0.05), { n: 4, speed: 0.6, up: 1.2, size: 0.1, ttl: 0.5, foam: false, jitter: 0.2 });
            if (sh.sound <= 0 && f.pos.distanceTo(cam) < 250) { sh.sound = 0.35; this.ctx.events.emit('sound', { id: 'flyingfish_splash', at: f.pos.clone(), vol: 0.6 }); }
          }
          const pitch = u < 0.12 ? 0.35 : u > 0.8 ? -0.3 : 0.02;
          tmpQ.setFromEuler(new THREE.Euler(pitch, headingOf(f.dir.x, f.dir.z), Math.sin(t * 7 + i) * 0.08, 'YXZ'));
          tmpS.setScalar(1.35);
          tmpM.compose(f.pos, tmpQ, tmpS);
          visible = true;
        }
      }
      if (!visible) tmpM.makeScale(0, 0, 0);
      for (const m of this.ffMeshes) m.setMatrixAt(i, tmpM);
      if (!f.landed) alive++;
    });
    for (const m of this.ffMeshes) m.instanceMatrix.needsUpdate = true;
    if (!alive) { this.sightings.flyingfish = null; for (const m of this.ffMeshes) m.visible = false; }
  }
}
