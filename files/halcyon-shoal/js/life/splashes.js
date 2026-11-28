// Shared spray / splash particles (bow slams, dolphin leaps, flying fish) plus short-lived foam patches on the sea.
import * as THREE from 'three';

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aLife; attribute float aSize;
uniform float uScale;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aLife > 0.0 ? aSize * uScale / max(-mv.z, 0.5) : 0.0;
  vA = aLife;
  #include <logdepthbuf_vertex>
}`;
const FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uBright;
varying float vA;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * uBright, a * 0.85);
}`;

export class Splashes {
  constructor(ctx, max = 900) {
    this.ctx = ctx; this.max = max; this.next = 0;
    this.pos = new Float32Array(max * 3); this.life = new Float32Array(max); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.age = new Float32Array(max); this.ttl = new Float32Array(max).fill(1); this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 500 }, uColor: { value: new THREE.Color(0xf4f8fa) }, uBright: { value: 1 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false; this.points.renderOrder = 2;
    ctx.scene.add(this.points);
    this.foam = [];      // {x, z, r, s, ttl, age}
    this.live = 0;
  }

  // burst of spray at p. opts: n, speed, up, size, ttl, dir (Vector3, optional bias), spread
  emit(p, o = {}) {
    const n = o.n ?? 30, speed = o.speed ?? 3, up = o.up ?? 4, size = o.size ?? 0.5, ttl = o.ttl ?? 1.4, spread = o.spread ?? 1;
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2, r = Math.random();
      let vx = Math.cos(a) * speed * r * spread, vz = Math.sin(a) * speed * r * spread;
      if (o.dir) { vx += o.dir.x * speed * (0.5 + Math.random() * 0.6); vz += o.dir.z * speed * (0.5 + Math.random() * 0.6); }
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * (o.jitter ?? 0.6); this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * (o.jitter ?? 0.6);
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = up * (0.4 + Math.random() * 0.8); this.vel[i * 3 + 2] = vz;
      this.size[i] = size * (0.5 + Math.random()); this.grow[i] = o.grow ?? 1.2;
      this.age[i] = 0; this.ttl[i] = ttl * (0.6 + Math.random() * 0.6); this.life[i] = 1;
    }
    this.live = this.max;
    if (o.foam !== false) this.foam.push({ x: p.x, z: p.z, r: o.foamR ?? Math.max(1.5, size * 6), s: o.foamS ?? 0.8, ttl: o.foamTtl ?? 5, age: 0 });
    if (this.foam.length > 16) this.foam.shift();
  }

  foamSpots() { return this.foam.map((f) => [f.x, f.z, f.r * (1 + f.age / f.ttl * 0.8), f.s * (1 - f.age / f.ttl)]); }

  update(dt, camera, night, exposure) {
    const h = this.ctx.renderer.domElement.height;
    this.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.uniforms.uBright.value = (night > 0.9 ? 0.06 : night > 0.5 ? 0.3 : 0.9) / Math.max(0.05, exposure);
    for (const f of this.foam) f.age += dt;
    this.foam = this.foam.filter((f) => f.age < f.ttl);
    if (!this.live) return;
    let any = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const k = this.age[i] / this.ttl[i];
      if (k >= 1) { this.life[i] = 0; continue; }
      any++;
      this.vel[i * 3 + 1] -= 9.81 * dt;
      const drag = Math.exp(-dt * 0.8);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] *= 1 + this.grow[i] * dt;
      this.life[i] = (1 - k) * Math.min(1, k * 8);
    }
    this.live = any;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }
}
