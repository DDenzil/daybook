// Underwater atmosphere: fog swap, light shafts, drifting particles, bubble streams.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { softSprite, shaftTexture } from '../core/noise.js';
import { shared } from '../core/materials.js';

export class Underwater {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.active = false;
    this.depth = 0;
    // light shafts: vertical additive cards around the camera
    const tex = shaftTexture();
    this.shafts = [];
    const shaftMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shaftMat.clone());
      m.userData = { ox: (Math.random() - 0.5) * 50, oz: (Math.random() - 0.5) * 50, w: 1.5 + Math.random() * 4, ph: Math.random() * 6.28 };
      m.scale.set(m.userData.w, 40, 1);
      this.group.add(m); this.shafts.push(m);
    }
    // suspended particles (marine snow)
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = (Math.random() - 0.5) * 30; pos[i * 3 + 2] = (Math.random() - 0.5) * 40; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.05, map: softSprite(32), color: 0xbfd8d0, transparent: true, opacity: 0.55, depthWrite: false }));
    this.particles.frustumCulled = false;
    this.group.add(this.particles);
    // bubble streams from riser bases and the jacket
    this.streams = [];
    const bm = new THREE.PointsMaterial({ size: 0.12, map: softSprite(32, 0.6), color: 0xdff4ff, transparent: true, opacity: 0.8, depthWrite: false });
    for (const s of [[-19.6, -27], [19.6, 9], [-13, 12]]) {
      const cnt = 60, p = new Float32Array(cnt * 3), seeds = new Float32Array(cnt);
      for (let i = 0; i < cnt; i++) { seeds[i] = Math.random(); p[i * 3 + 1] = -CONFIG.waterDepth + seeds[i] * CONFIG.waterDepth; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const pts = new THREE.Points(g, bm); pts.position.set(s[0], 0, s[1]); pts.userData.seeds = seeds; pts.frustumCulled = false;
      this.group.add(pts); this.streams.push(pts);
    }
    this.group.visible = false;
  }

  // Swap the atmosphere when the camera crosses the waterline
  setActive(on, scene, sky, preset) {
    this.active = on;
    this.group.visible = on;
    sky.sky.visible = !on; sky.stars.visible = !on && sky.stars.material.opacity > 0;
    if (on) {
      scene.fog.color.setHex(preset.uwFog); scene.fog.density = CONFIG.fogBelowDensity;
      scene.background = new THREE.Color(preset.uwFog);
      sky.hemi.color.setHex(0x7fd0d4); sky.hemi.groundColor.setHex(0x1d4a44); sky.hemi.intensity = preset.hemi + 0.9 * Math.max(0.15, Math.min(1, preset.sun / 2));
      sky.sun.intensity = preset.sun * 0.55;
    } else {
      scene.fog.color.setHex(preset.fog); scene.fog.density = CONFIG.fogAboveDensity;
      scene.background = null;
      sky.hemi.color.setHex(0xdfe8f2); sky.hemi.groundColor.setHex(0x2a3c44); sky.hemi.intensity = preset.hemi;
      sky.sun.intensity = preset.sun;
    }
  }

  update(dt, t, camera, surfaceY) {
    if (!this.active) return;
    this.depth = surfaceY - camera.position.y;
    const sunUp = Math.max(0, shared.uSunDir.value.y);
    const c = camera.position;
    for (const s of this.shafts) {
      const u = s.userData;
      s.position.set(c.x + u.ox, surfaceY - 20, c.z + u.oz);
      s.lookAt(c.x, s.position.y, c.z);
      s.rotation.z = (shared.uSunDir.value.x) * 0.35;
      s.material.opacity = (0.05 + 0.06 * Math.sin(t * 0.6 + u.ph)) * sunUp * Math.exp(-this.depth * 0.02);
    }
    const p = this.particles.geometry.attributes.position;
    const wrap = (v, c, h) => c + ((((v - c + h) % (2 * h)) + 2 * h) % (2 * h)) - h;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      y -= dt * 0.03; x += Math.sin(t * 0.3 + i) * dt * 0.05;
      p.setXYZ(i, wrap(x, c.x, 20), wrap(y, c.y, 15), wrap(z, c.z, 20));
    }
    p.needsUpdate = true;
    for (const s of this.streams) {
      const pos = s.geometry.attributes.position, seeds = s.userData.seeds;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * (0.6 + seeds[i] * 0.8);
        if (y > surfaceY - 0.2) y = -CONFIG.waterDepth + 0.5;
        pos.setXYZ(i, Math.sin(t * 2 + seeds[i] * 30) * 0.25, y, Math.cos(t * 1.7 + seeds[i] * 20) * 0.25);
      }
      pos.needsUpdate = true;
    }
  }
}
