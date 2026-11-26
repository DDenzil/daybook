// Seabed: camera-following terrain patch with sand ripples, scour pits round structures,
// instanced rocks, corals, sponges and swaying seagrass near the platforms.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { patchMaterial } from '../core/materials.js';
import { findNode, bakedMeshes } from '../core/assets.js';

export class Seabed {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.pits = [];            // [x, z, radius, depth]
    this.size = 360;
    this.segs = ctx.quality.tierName === 'phone' ? 90 : 128;
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.segs, this.segs);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xb8a37c, roughness: 0.95, metalness: 0, map: sandTexture(), normalMap: rippleNormal(), normalScale: new THREE.Vector2(0.8, 0.8) });
    this.mat.map.repeat.set(this.size / 6, this.size / 6); this.mat.normalMap.repeat.set(this.size / 3, this.size / 3);
    patchMaterial(this.mat, { caustic: true });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.center = new THREE.Vector2(1e9, 1e9);
  }

  heightAt(x, z) {
    let y = -CONFIG.waterDepth + Math.sin(x * 0.011) * 0.9 + Math.cos(z * 0.014) * 0.7 + Math.sin((x + z) * 0.05) * 0.25;
    for (const [px, pz, r, d] of this.pits) {
      const dd = Math.hypot(x - px, z - pz);
      if (dd < r) y -= d * (0.5 + 0.5 * Math.cos(Math.PI * dd / r));
    }
    return y;
  }

  setStructures(list) {   // list of {x, z, legs: [[x,z],...]}
    this.pits = [];
    for (const s of list) for (const l of s.legs) this.pits.push([s.x + l[0], s.z + l[1], 7, 1.3]);
    this.center.set(1e9, 1e9);
  }

  rebuild(cx, cz) {
    const pos = this.mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
      pos.setY(i, this.heightAt(x, z));
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.position.set(cx, 0, cz);
    this.mat.map.offset.set(cx / 6, -cz / 6); this.mat.normalMap.offset.set(cx / 3, -cz / 3);
    this.center.set(cx, cz);
  }

  update(camera) {
    const snap = 40;
    const cx = Math.round(camera.position.x / snap) * snap, cz = Math.round(camera.position.z / snap) * snap;
    if (cx !== this.center.x || cz !== this.center.y) this.rebuild(cx, cz);
  }

  // Scatter props and seagrass around a structure
  async scatter(assets, sites, count) {
    const g = await assets.get('seabed_props');
    const variants = ['rock_0', 'rock_1', 'rock_2', 'coral_0', 'coral_1', 'sponge_0'].map((n) => findNode(g.scene, n)).filter(Boolean);
    if (this.props) { this.props.forEach((m) => this.group.remove(m)); }
    this.props = [];
    const per = Math.ceil(count / Math.max(1, sites.length));
    for (const v of variants) {
      for (const src of bakedMeshes(v)) {
        const im = new THREE.InstancedMesh(src.geometry, src.material, per * sites.length);
        im.receiveShadow = true;
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
        let k = 0;
        sites.forEach((site, si) => {
          const rnd = mulberry(si * 97 + v.name.length * 13 + v.name.charCodeAt(v.name.length - 1));
          const share = v.name.startsWith('coral') ? 0.12 : v.name.startsWith('sponge') ? 0.2 : 0.34;
          for (let i = 0; i < per * share; i++) {
            const a = rnd() * Math.PI * 2, r = 6 + rnd() * site.r;
            const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
            const sc = v.name.startsWith('rock') ? 0.6 + rnd() * 1.8 : 0.6 + rnd() * 0.9;
            p.set(x, this.heightAt(x, z) + (v.name.startsWith('rock') ? 0.2 * sc : -0.05), z);
            q.setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0)); s.setScalar(sc);
            m.compose(p, q, s); im.setMatrixAt(k++, m);
          }
        });
        im.count = k;
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        this.group.add(im); this.props.push(im);
      }
    }
    this.addSeagrass(sites, count * 4);
  }

  addSeagrass(sites, n) {
    if (this.grass) this.group.remove(this.grass);
    const blade = new THREE.PlaneGeometry(0.06, 0.7, 1, 4); blade.translate(0, 0.35, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4e6b2f, roughness: 0.8, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.ctx.timeUniform;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 gw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sway = sin(uTime * 1.3 + gw.x * 0.4 + gw.z * 0.3) * 0.18 * position.y * position.y;
        transformed.x += sway; transformed.z += sway * 0.5;`);
    };
    patchMaterial(mat, { caustic: true });
    const baseKey = mat.customProgramCacheKey; mat.customProgramCacheKey = () => baseKey() + ':grass';
    const im = new THREE.InstancedMesh(blade, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const rnd = mulberry(5);
    let k = 0;
    for (const site of sites) {
      for (let c = 0; c < 6; c++) {   // clumps
        const a = rnd() * 6.28, r = 15 + rnd() * site.r;
        const cx = site.x + Math.cos(a) * r, cz = site.z + Math.sin(a) * r;
        for (let i = 0; i < n / sites.length / 6 && k < n; i++) {
          const x = cx + (rnd() - 0.5) * 7, z = cz + (rnd() - 0.5) * 7;
          p.set(x, this.heightAt(x, z), z); q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, rnd() * 6.28, 0)); s.set(1, 0.6 + rnd() * 0.9, 1);
          m.compose(p, q, s); im.setMatrixAt(k++, m);
        }
      }
    }
    im.count = k; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    this.grass = im; this.group.add(im);
  }
}

export function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function sandTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(s, s);
  const r = mulberry(9);
  for (let i = 0; i < s * s; i++) {
    const v = 0.85 + r() * 0.15 - (r() < 0.02 ? 0.25 : 0);
    img.data[i * 4] = 255 * v; img.data[i * 4 + 1] = 245 * v; img.data[i * 4 + 2] = 225 * v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rippleNormal() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const ph = (x / s) * Math.PI * 2 * 3 + Math.sin((y / s) * Math.PI * 2) * 0.8;
    const dx = Math.cos(ph) * 0.5;
    const nx = -dx, nz = 1; const l = Math.hypot(nx, nz);
    const i = (y * s + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = 128; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  return t;
}
