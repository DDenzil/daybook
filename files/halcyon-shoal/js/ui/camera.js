// Camera: orbit controls, preset flights along an arc, follow mode, guided tour and collision.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from '../config.js';

export const PRESETS = {
  overview: { label: 'Overview', pos: [-620, 260, 520], target: [-40, 20, 0], caption: 'Halcyon Shoal: central processing platform, living quarters and bridge. The wellheads sit 2 to 8 km out, so they are small and hazy from here.' },
  cpp: { label: 'Process platform', pos: [95, 62, 120], target: [0, 32, 0], caption: 'HS-CPP: inlet separation, gas compression, dehydration and export. 8-leg jacket in 45 m of water.' },
  flare: { label: 'Flare', pos: [-25, 62, 35], target: [66, 90, -78], caption: 'The flare boom carries the burner 86 m clear of the topsides. Its flame grows with the export rate.' },
  helideck: { label: 'Living quarters', pos: [CONFIG.lq.x - 70, 70, CONFIG.lq.z + 60], target: [CONFIG.lq.x - 6, 44, CONFIG.lq.z], caption: 'HS-LQ: accommodation for the crew, lifeboats, radio mast and a 21 m helideck.' },
  subsea: { label: 'Subsea', pos: [-38, -9, 47], target: [-20, -17, 26], caption: 'Below the surface: the jacket, risers and anodes, marine growth in the splash zone, and the fish that gather round the structure.' },
  wellhead: { label: 'Wellhead', pos: null, target: null, caption: 'An unmanned wellhead platform: six wells, solar power and a flowline running back along the seabed to HS-CPP.' },
  shore: { label: 'Shore terminal', pos: [-650, 140, -420], target: [320, 10, 0], caption: 'The receiving terminal and trunkline landfall, about 78 km from the field.' }
};
export const TOUR = ['overview', 'cpp', 'flare', 'helideck', 'subsea', 'wellhead', 'shore', 'overview'];

export class CameraRig extends EventTarget {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    const { camera, renderer } = ctx;
    this.controls = new OrbitControls(camera, renderer.domElement);
    const c = this.controls;
    c.enableDamping = true; c.dampingFactor = 0.07;
    c.minDistance = 3; c.maxDistance = 9000;
    c.minPolarAngle = 0.02; c.maxPolarAngle = Math.PI - 0.02;
    c.zoomSpeed = 1.1; c.panSpeed = 0.9; c.rotateSpeed = 0.6;
    c.screenSpacePanning = true;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.flight = null; this.followObj = null; this.followOffset = new THREE.Vector3();
    this.tour = null;
    c.addEventListener('start', () => { this.flight = null; if (this.followObj) this.stopFollow(); if (this.tour) this.stopTour(); });
    this.scene = 'field';
  }

  presetFor(key) {
    if (key === 'wellhead') {
      const w = this.ctx.state.selected || this.ctx.field.wellheads[0];
      if (!w) return PRESETS.overview;
      const dir = new THREE.Vector2(w.x, w.z).normalize();
      return { ...PRESETS.wellhead, pos: [w.x + dir.x * 60 - dir.y * 35, 38, w.z + dir.y * 60 + dir.x * 35], target: [w.x, 16, w.z] };
    }
    return PRESETS[key];
  }

  go(key, duration) {
    const p = this.presetFor(key); if (!p) return;
    const wantScene = key === 'shore' ? 'shore' : 'field';
    this.stopFollow();
    if (wantScene !== this.scene) {
      this.scene = wantScene;
      this.dispatchEvent(new CustomEvent('scene', { detail: wantScene }));
      this.ctx.camera.position.set(...p.pos); this.controls.target.set(...p.target); this.controls.update();
    } else this.flyTo(new THREE.Vector3(...p.pos), new THREE.Vector3(...p.target), duration);
    this.dispatchEvent(new CustomEvent('preset', { detail: { key, caption: p.caption } }));
  }

  flyTo(pos, target, duration) {
    const cam = this.ctx.camera;
    const from = cam.position.clone(), fromT = this.controls.target.clone();
    const dist = from.distanceTo(pos);
    const d = duration ?? THREE.MathUtils.clamp(1.4 + dist / 900, 1.6, 5.5);
    const mid = from.clone().lerp(pos, 0.5);
    const bothAbove = from.y > 2 && pos.y > 2;
    const bothBelow = from.y < -1 && pos.y < -1;
    if (bothAbove) mid.y = Math.max(mid.y, Math.max(from.y, pos.y) + dist * 0.18);
    else if (!bothBelow) mid.y = Math.max(from.y, pos.y) + 15;   // surface first, then dive / climb
    this.flight = { from, mid, to: pos, fromT, toT: target, t: 0, d };
  }

  follow(obj, offset) {
    this.followObj = obj; this.flight = null;
    const p = new THREE.Vector3(); obj.getWorldPosition(p);
    if (offset) {   // jump in close, then keep the same relative position as the object moves
      this.ctx.camera.position.copy(p).add(offset);
      this.controls.target.copy(p);
    } else if (this.ctx.camera.position.distanceTo(p) > 300) {
      this.ctx.camera.position.copy(p).add(new THREE.Vector3(50, 25, 50));
      this.controls.target.copy(p);
    }
    this.dispatchEvent(new CustomEvent('follow', { detail: true }));
  }
  stopFollow() { if (this.followObj) { this.followObj = null; this.dispatchEvent(new CustomEvent('follow', { detail: false })); } }

  startTour() {
    this.tour = { i: 0, t: 0 };
    this.go(TOUR[0]);
    this.dispatchEvent(new CustomEvent('tour', { detail: true }));
  }
  stopTour() { this.tour = null; this.dispatchEvent(new CustomEvent('tour', { detail: false })); }

  update(dt) {
    const cam = this.ctx.camera, c = this.controls;
    if (this.tour) {
      this.tour.t += dt;
      if (this.tour.t > 11) {
        this.tour.t = 0; this.tour.i++;
        if (this.tour.i >= TOUR.length) this.stopTour(); else this.go(TOUR[this.tour.i]);
      }
      if (!this.flight && this.tour) {   // slow orbit while dwelling
        const off = cam.position.clone().sub(c.target); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.04); cam.position.copy(c.target).add(off);
      }
    }
    if (this.flight) {
      const f = this.flight; f.t += dt / f.d;
      const k = f.t >= 1 ? 1 : f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      const a = f.from.clone().lerp(f.mid, k), b = f.mid.clone().lerp(f.to, k);
      cam.position.copy(a.lerp(b, k));
      c.target.lerpVectors(f.fromT, f.toT, k);
      if (f.t >= 1) this.flight = null;
    } else if (this.followObj) {
      const p = new THREE.Vector3(); this.followObj.getWorldPosition(p);
      const delta = p.clone().sub(c.target);
      c.target.add(delta); cam.position.add(delta);
    }
    c.update();
    this.collide();
  }

  collide() {
    const cam = this.ctx.camera.position;
    if (this.scene === 'field') {
      const floor = this.ctx.seabed.heightAt(cam.x, cam.z) + 1.5;
      if (cam.y < floor) cam.y = floor;
      for (const b of this.ctx.colliders || []) {
        if (b.containsPoint(cam)) {
          // push out through the nearest face
          const dx0 = cam.x - b.min.x, dx1 = b.max.x - cam.x, dz0 = cam.z - b.min.z, dz1 = b.max.z - cam.z, dy1 = b.max.y - cam.y;
          const m = Math.min(dx0, dx1, dz0, dz1, dy1);
          if (m === dx0) cam.x = b.min.x; else if (m === dx1) cam.x = b.max.x; else if (m === dz0) cam.z = b.min.z; else if (m === dz1) cam.z = b.max.z; else cam.y = b.max.y;
        }
      }
    }
    if (cam.y > 5000) cam.y = 5000;
  }
}
