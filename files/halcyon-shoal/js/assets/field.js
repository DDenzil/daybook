// The Halcyon Shoal facility: CPP, LQ, bridge, wellheads (instanced), flowlines, trunkline, crane,
// windsock and deck lamps. Positions in metres; CPP at the origin.
import * as THREE from 'three';
import { CONFIG, wellheadCode } from '../config.js';
import { findNode } from '../core/assets.js';
import { patchMaterial } from '../core/materials.js';
import { Flare } from './flare.js';

const MAX_WHP = 20;

export class Field extends EventTarget {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.wellheads = [];
    this.nextId = 1;
    this.lamps = [];
    this.legSpots = [];
  }

  async build(settings) {
    const { assets } = this.ctx;
    this.cpp = await assets.instance('cpp');
    this.lq = await assets.instance('lq');
    this.bridge = await assets.instance('bridge');
    this.lq.position.set(CONFIG.lq.x, 0, CONFIG.lq.z);
    this.group.add(this.cpp, this.lq, this.bridge);
    this.group.updateMatrixWorld(true);

    // crane rig
    this.crane = {
      slew: findNode(this.cpp, 'crane_slew'), boom: findNode(this.cpp, 'crane_boom'),
      tip: findNode(this.cpp, 'crane_tip'), hook: findNode(this.cpp, 'crane_hook'), cable: findNode(this.cpp, 'crane_cable')
    };
    this.initCrane();
    this.windsock = findNode(this.lq, 'windsock');
    this.helideck = new THREE.Vector3(); findNode(this.lq, 'helideck_centre').getWorldPosition(this.helideck);
    this.flareTip = new THREE.Vector3(); findNode(this.cpp, 'flare_tip').getWorldPosition(this.flareTip);
    for (const root of [this.cpp, this.lq]) root.traverse((o) => { if (/^lamp_/.test(o.name)) { const p = new THREE.Vector3(); o.getWorldPosition(p); this.lamps.push(p); } });

    this.flare = new Flare(this.ctx, this.flareTip);
    this.group.add(this.flare.group);

    // wellhead instancing
    const whp = await assets.get('whp');
    this.whpParts = [];
    whp.scene.updateMatrixWorld(true);
    whp.scene.traverse((o) => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, MAX_WHP);
      im.castShadow = true; im.receiveShadow = true; im.count = 0;
      im.userData.local = o.matrixWorld.clone();
      this.group.add(im); this.whpParts.push(im);
    });
    this.whpRiserBase = new THREE.Vector3(); findNode(whp.scene, 'riser_base').getWorldPosition(this.whpRiserBase);

    // flowline / trunkline materials
    this.lineMat = new THREE.MeshStandardMaterial({ color: 0x6b6f66, roughness: 0.92, metalness: 0.05, name: 'concrete_coat' });
    patchMaterial(this.lineMat, { grime: true, caustic: true });
    this.buildTrunkline();

    // leg positions at the waterline for contact foam
    const legs = (x0, z0, xs, zs, top, bat = 0.1) => xs.flatMap((x) => zs.map((z) => [x0 + x + Math.sign(x) * top * bat, z0 + z + Math.sign(z) * top * bat]));
    this.cppLegs = legs(0, 0, [-18, 18], [-27, -9, 9, 27], 18);
    this.lqLegs = legs(CONFIG.lq.x, CONFIG.lq.z, [-12, 12], [-10, 10], 18);

    for (const w of settings.field.wellheads) this.addWellhead(w.pos[0], w.pos[1], { code: w.code, flow: w.flow, pressure: w.pressure, silent: true });
  }

  // ------------------------------------------------------------------ wellheads
  addWellhead(x, z, opts = {}) {
    if (this.wellheads.length >= MAX_WHP) return null;
    const id = this.nextId++;
    const t = this.ctx.settings.telemetry;
    const w = {
      id, code: opts.code || wellheadCode(id), x, z,
      flow: opts.flow ?? Math.round(t.newWellFlowMin + Math.random() * (t.newWellFlowMax - t.newWellFlowMin)),
      pressure: opts.pressure ?? Math.round(136 + Math.random() * 14),
      line: null, lineLength: 0
    };
    this.wellheads.push(w);
    this.refreshWellhead(w);
    this.dispatchEvent(new CustomEvent('wellheads', { detail: { type: 'add', w, silent: !!opts.silent } }));
    return w;
  }

  moveWellhead(w, x, z, commit = true) {
    w.x = x; w.z = z;
    this.updateInstances();
    if (commit) { this.refreshWellhead(w); this.dispatchEvent(new CustomEvent('wellheads', { detail: { type: 'move', w } })); }
  }

  removeWellhead(w) {
    if (this.wellheads.length <= 1) return false;
    this.wellheads = this.wellheads.filter((o) => o !== w);
    if (w.line) { this.group.remove(w.line); w.line.geometry.dispose(); }
    this.updateInstances();
    this.dispatchEvent(new CustomEvent('wellheads', { detail: { type: 'remove', w } }));
    return true;
  }

  refreshWellhead(w) {
    this.updateInstances();
    if (w.line) { this.group.remove(w.line); w.line.geometry.dispose(); }
    w.line = this.buildFlowline(w);
    this.group.add(w.line);
  }

  updateInstances() {
    const m = new THREE.Matrix4(), out = new THREE.Matrix4();
    for (const im of this.whpParts) {
      this.wellheads.forEach((w, i) => {
        m.makeTranslation(w.x, 0, w.z);
        out.multiplyMatrices(m, im.userData.local);
        im.setMatrixAt(i, out);
      });
      im.count = this.wellheads.length;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();      // lets the shadow pass and the camera cull distant wellheads
    }
  }

  // Flowline from the wellhead riser foot across the seabed to a CPP riser
  buildFlowline(w) {
    const sb = this.ctx.seabed;
    const start = new THREE.Vector3(w.x + this.whpRiserBase.x, 0, w.z + this.whpRiserBase.z);
    const riserZ = w.z < -400 ? -27 : w.z < 0 ? -9 : w.z < 400 ? 9 : 27;
    const end = new THREE.Vector3(-24.5, 0, riserZ);
    const L = start.distanceTo(end);
    const n = Math.max(6, Math.round(L / 60));
    const side = new THREE.Vector3(-(end.z - start.z), 0, end.x - start.x).normalize();
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = start.clone().lerp(end, t).addScaledVector(side, Math.sin(t * Math.PI) * L * 0.035 * Math.sin(w.id * 1.7));
      p.y = sb.heightAt(p.x, p.z) + 0.15;
      pts.push(p);
    }
    pts.unshift(new THREE.Vector3(start.x, sb.heightAt(start.x, start.z) + 3, start.z));
    pts.push(new THREE.Vector3(end.x + 2, sb.heightAt(end.x, end.z) + 2.5, end.z));
    const curve = new THREE.CatmullRomCurve3(pts);
    w.lineLength = curve.getLength();
    const geo = new THREE.TubeGeometry(curve, Math.min(400, n * 4), 0.32, 8, false);
    const mesh = new THREE.Mesh(geo, this.lineMat);
    mesh.receiveShadow = true;
    return mesh;
  }

  buildTrunkline() {
    const sb = this.ctx.seabed;
    const pts = [];
    for (let x = 24; x <= 6000; x += x < 200 ? 20 : 120) {
      const z = -9 + Math.sin(x * 0.0007) * 40;
      pts.push(new THREE.Vector3(x, sb.heightAt(x, z) + 0.3, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 300, 0.6, 10, false), this.lineMat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.trunkline = mesh;
  }

  // ------------------------------------------------------------------ crane
  initCrane() {
    const c = this.crane;
    if (!c.slew || !c.boom || !c.tip) { this.crane = null; return; }
    c.restYaw = c.slew.rotation.y;
    c.restLuff = c.boom.rotation.x;
    const heel = new THREE.Vector3(), tip = new THREE.Vector3();
    c.boom.getWorldPosition(heel); c.tip.getWorldPosition(tip);
    c.L = heel.distanceTo(tip);
    c.restAngle = Math.atan2(tip.x - heel.x, tip.z - heel.z);
    const e0 = Math.asin((tip.y - heel.y) / c.L);
    c.boom.rotation.x += 0.01; c.boom.updateMatrixWorld(true); c.tip.getWorldPosition(tip);
    const e1 = Math.asin((tip.y - heel.y) / c.L);
    c.luffSign = Math.sign(e1 - e0) || 1;
    c.boom.rotation.x = c.restLuff;
    c.restElev = e0;
    c.yaw = 0; c.elev = e0; c.cableLen = 10;
    this.craneTarget = null;
    this.setCrane(null, 0);
  }

  // Aim the crane hook at a world position (or park it). Smoothly follows the target.
  setCrane(target, dt) {
    const c = this.crane; if (!c) return;
    const heel = new THREE.Vector3(); c.boom.getWorldPosition(heel);
    let yaw = 0, elev = c.restElev, cable = 8;
    if (target) {
      const ang = Math.atan2(target.x - heel.x, target.z - heel.z);
      yaw = ang - c.restAngle;
      while (yaw > Math.PI) yaw -= Math.PI * 2; while (yaw < -Math.PI) yaw += Math.PI * 2;
      const h = Math.hypot(target.x - heel.x, target.z - heel.z);
      elev = Math.acos(THREE.MathUtils.clamp(h / c.L, 0.2, 0.97));
      cable = Math.max(2, heel.y + Math.sin(elev) * c.L - target.y);
    }
    const k = dt > 0 ? Math.min(1, dt * 0.8) : 1;
    c.yaw += (yaw - c.yaw) * k; c.elev += (elev - c.elev) * k; c.cableLen += (cable - c.cableLen) * k;
    c.slew.rotation.y = c.restYaw + c.yaw;
    c.boom.rotation.x = c.restLuff + (c.elev - c.restElev) * c.luffSign;
    c.slew.updateMatrixWorld(true);
    const tip = new THREE.Vector3(); c.tip.getWorldPosition(tip);
    this.cpp.worldToLocal(tip);
    c.cable.position.copy(tip); c.cable.scale.set(1, c.cableLen, 1);
    c.hook.position.set(tip.x, tip.y - c.cableLen, tip.z);
  }

  hookWorld(out) { if (!this.crane) return out.set(0, 40, -60); return this.crane.hook.getWorldPosition(out); }

  // ------------------------------------------------------------------ per frame
  update(dt, t, wind) {
    if (this.windsock) {
      const a = wind.dir;
      const dx = Math.sin(a), dz = -Math.cos(a);
      this.windsock.rotation.set(0, Math.atan2(-dz, dx) + Math.sin(t * 2.3) * 0.08 + Math.sin(t * 5.1) * 0.03, -Math.max(0, 0.6 - wind.speed * 0.05) + Math.sin(t * 3.7) * 0.03);
    }
    this.flare.update(dt, t, wind, this.ctx.telemetry ? this.ctx.telemetry.exportRate() : 1400);
  }

  waterlineSpots(seaFoam) {
    const s = 0.35 + seaFoam * 0.6;
    const out = [];
    for (const [x, z] of this.cppLegs) out.push([x, z, 3.0, s]);
    for (const [x, z] of this.lqLegs) out.push([x, z, 2.6, s]);
    for (const w of this.wellheads.slice(0, 4)) for (const [dx, dz] of [[-8.6, -8.6], [8.6, -8.6], [8.6, 8.6], [-8.6, 8.6]]) out.push([w.x + dx, w.z + dz, 2.2, s]);
    return out;
  }

  structures() {
    const s = [{ x: 0, z: 0, legs: this.cppLegs.map(([x, z]) => [x * 1.35, z * 1.15]) }, { x: 0, z: 0, legs: this.lqLegs.map(([x, z]) => [CONFIG.lq.x + (x - CONFIG.lq.x) * 1.4, CONFIG.lq.z + (z - CONFIG.lq.z) * 1.4]) }];
    for (const w of this.wellheads) s.push({ x: w.x, z: w.z, legs: [[-13, -13], [13, -13], [13, 13], [-13, 13]] });
    return s;
  }

  // Obstacles for camera collision: axis-aligned boxes in world space
  colliders() {
    const out = [new THREE.Box3(new THREE.Vector3(-26, 18, -35), new THREE.Vector3(26, 46, 35)),
      new THREE.Box3(new THREE.Vector3(CONFIG.lq.x - 16, 18, CONFIG.lq.z - 14), new THREE.Vector3(CONFIG.lq.x + 16, 46, CONFIG.lq.z + 14))];
    for (const w of this.wellheads) out.push(new THREE.Box3(new THREE.Vector3(w.x - 11, 17, w.z - 10), new THREE.Vector3(w.x + 11, 30, w.z + 10)));
    return out;
  }
}
