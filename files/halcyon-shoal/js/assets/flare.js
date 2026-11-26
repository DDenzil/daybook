// Flare: crossed flame cards with an animated noise shader, glow, drifting smoke and a flickering light.
// Flame size follows the gas export figure; the flame leans downwind.
import * as THREE from 'three';
import { softSprite } from '../core/noise.js';

const FLAME_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FLAME_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime; uniform float uSeed; uniform float uBright;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += n(p) * a; p *= 2.03; a *= 0.5; } return v; }
void main() {
  #include <logdepthbuf_fragment>
  vec2 uv = vUv;
  float t = uTime * 1.6 + uSeed * 10.0;
  float y = uv.y;
  float nn = fbm(vec2(uv.x * 3.0 + uSeed, y * 2.2 - t));
  float nn2 = fbm(vec2(uv.x * 7.0 - uSeed, y * 5.0 - t * 1.7));
  float x = (uv.x - 0.5) * 2.0 + (nn - 0.5) * 0.9 * y;
  float width = pow(1.0 - y, 0.55) * (0.55 + 0.45 * sin(y * 3.14159)) * 1.05;
  float body = 1.0 - smoothstep(width * 0.35, width, abs(x));
  body *= smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.55 + nn * 0.45, 1.0, y));
  float flame = clamp(body * (0.65 + nn2 * 0.7), 0.0, 1.0);
  float core = (1.0 - smoothstep(0.0, width * 0.45, abs(x))) * (1.0 - smoothstep(0.0, 0.45, y));
  vec3 col = mix(vec3(0.9, 0.18, 0.02), vec3(1.0, 0.55, 0.08), flame);
  col = mix(col, vec3(1.0, 0.92, 0.65), core * flame);
  gl_FragColor = vec4(col * flame * uBright * (1.0 + core * 2.0), flame);
}`;

export class Flare {
  constructor(ctx, tip) {
    this.ctx = ctx;
    this.tip = tip.clone();
    this.group = new THREE.Group();
    this.group.position.copy(tip);
    this.flame = new THREE.Group();
    this.group.add(this.flame);
    this.cards = [];
    const n = ctx.quality.tierName === 'phone' ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const g = new THREE.PlaneGeometry(1, 1, 1, 1); g.translate(0, 0.5, 0);
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: i * 1.37 }, uBright: { value: 3.0 } },
        vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.y = (i / n) * Math.PI;
      mesh.frustumCulled = false;
      this.flame.add(mesh); this.cards.push(mesh);
    }
    const glowTex = softSprite(64);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a2a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 }));
    this.glow.scale.set(26, 26, 1); this.glow.position.y = 6;
    this.group.add(this.glow);
    // smoke
    this.smoke = [];
    const smokeMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x3a3634, transparent: true, depthWrite: false, opacity: 0.1 });
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(smokeMat.clone()); s.userData.ph = i / 14;
      this.group.add(s); this.smoke.push(s);
    }
    this.light = new THREE.PointLight(0xff8a3d, 2000, 0, 2);
    this.light.position.set(0, 8, 0);
    this.group.add(this.light);
    this.height = 20;
  }

  update(dt, t, wind, exportRate) {
    const target = 14 + (exportRate / 1400) * 10;
    this.height += (target - this.height) * Math.min(1, dt * 0.5);
    const flick = 1 + Math.sin(t * 13.1) * 0.06 + Math.sin(t * 7.3) * 0.08 + Math.sin(t * 23.7) * 0.04;
    const H = this.height * flick, W = this.height * 0.42;
    for (const c of this.cards) { c.scale.set(W, H, 1); c.material.uniforms.uTime.value = t; }
    // lean downwind
    const dx = Math.sin(wind.dir), dz = -Math.cos(wind.dir);
    const lean = 0.25 + Math.min(0.5, wind.speed * 0.035);
    this.flame.rotation.set(dz * lean, 0, -dx * lean);
    const night = this.ctx.night;
    this.glow.material.opacity = 0.3 + night * 0.15;
    this.glow.scale.setScalar(this.height * (1.2 + night * 0.35) * flick);
    this.light.intensity = (night * 5000 + 500) * flick;
    this.light.position.set(dx * 4, H * 0.35, dz * 4);
    for (const s of this.smoke) {
      const p = (s.userData.ph + t * 0.03) % 1;
      s.position.set(dx * (H * 0.5 + p * 90), H * 0.8 + p * 55, dz * (H * 0.5 + p * 90));
      const sc = 8 + p * 40; s.scale.set(sc, sc, 1);
      s.material.opacity = 0.14 * Math.sin(p * Math.PI) * (1 - night * 0.5);
    }
  }

  worldTop(out) { return out.copy(this.tip).add(new THREE.Vector3(0, this.height * 0.6, 0)); }
}
