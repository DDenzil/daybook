// Ocean surface: Gerstner waves (same maths in GLSL and JS so floating objects match the visible sea),
// camera-following radial grid to the horizon, Earth curvature, sky reflection, sub-surface glow,
// crest / contact / wake foam, night light glints, and the view from below (Snell's window).
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { waterNormalTexture } from '../core/noise.js';

const MAXW = 10, MAXSPOTS = 48, MAXTRAIL = 40, MAXLIGHTS = 6;
const BASE_WAVES = [ // wavelength m, amplitude m, direction deg (relative to wind), steepness
  [64, 0.42, 0, 0.55], [42, 0.27, -18, 0.55], [27, 0.17, 26, 0.5], [17, 0.1, -38, 0.5], [11, 0.062, 12, 0.45],
  [7.1, 0.04, 55, 0.4], [4.6, 0.025, -62, 0.35], [3.1, 0.016, 33, 0.3], [2.0, 0.01, -24, 0.3], [1.3, 0.006, 80, 0.25]];

export class Waves {
  constructor() {
    this.windDir = THREE.MathUtils.degToRad(135);   // shamal from the north-west, waves running south-east
    this.amp = 1; this.choppy = 1; this.count = 8;
    this.list = [];
    this.rebuild();
  }
  setSeaState(s) { this.amp = s.amp; this.choppy = Math.min(s.choppy, 1 / Math.max(0.5, s.amp)); this.foam = s.foam; this.wind = s.wind; }
  setCount(n) { this.count = Math.min(MAXW, n); this.rebuild(); }
  rebuild() {
    this.list = [];
    const n = this.count;
    let seed = 3;
    for (let i = 0; i < n; i++) {
      const [L, A, dd, Q] = BASE_WAVES[i];
      const a = this.windDir + THREE.MathUtils.degToRad(dd);
      const k = 2 * Math.PI / L;
      seed = (seed * 9301 + 49297) % 233280;
      this.list.push({ dx: Math.sin(a), dz: -Math.cos(a), k, A, w: Math.sqrt(CONFIG.gravity * k), q: Q / (k * A * n), phase: (seed / 233280) * Math.PI * 2, L });
    }
  }
  // Displacement at an undisplaced grid point (x, z)
  displace(x, z, t, out) {
    let dx = 0, dy = 0, dz = 0;
    for (const w of this.list) {
      const A = w.A * this.amp, Q = w.q * this.choppy;
      const th = w.k * (w.dx * x + w.dz * z) - w.w * t + w.phase;
      const c = Math.cos(th);
      dx += Q * A * w.dx * c; dz += Q * A * w.dz * c; dy += A * Math.sin(th);
    }
    out.x = dx; out.y = dy; out.z = dz; return out;
  }
  // Surface height at world (x, z): invert the horizontal Gerstner shift with two fixed-point steps
  heightAt(x, z, t) {
    const d = _d; let px = x, pz = z;
    for (let i = 0; i < 2; i++) { this.displace(px, pz, t, d); px = x - d.x; pz = z - d.z; }
    this.displace(px, pz, t, d);
    return d.y;
  }
}
const _d = new THREE.Vector3();

function oceanGeometry(radial, near, maxR) {
  const rings = [0];
  let r = near, step = near;
  while (r < 40) { rings.push(r); r += step; }
  while (r < maxR) { rings.push(r); step *= 1.055; r += step; }
  rings.push(maxR);
  const pos = [];
  pos.push(0, 0, 0);
  for (let i = 1; i < rings.length; i++) for (let j = 0; j < radial; j++) {
    const a = j / radial * Math.PI * 2;
    pos.push(Math.cos(a) * rings[i], 0, Math.sin(a) * rings[i]);
  }
  const idx = [];
  for (let j = 0; j < radial; j++) idx.push(0, 1 + (j + 1) % radial, 1 + j);
  for (let i = 1; i < rings.length - 1; i++) {
    const a0 = 1 + (i - 1) * radial, b0 = 1 + i * radial;
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), maxR);
  return g;
}

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec4 uWA[${MAXW}]; uniform vec4 uWB[${MAXW}];
uniform int uWaveCount; uniform float uTime, uAmp, uChoppy, uEarthR;
varying vec3 vWorld; varying vec3 vNrm; varying float vHeight; varying float vDist; varying float vCrest;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 p = wp.xz;
  float dist = length(p - cameraPosition.xz);
  vec3 disp = vec3(0.0); float nx = 0.0, nz = 0.0, ny = 0.0;
  for (int i = 0; i < ${MAXW}; i++) {
    if (i >= uWaveCount) break;
    vec2 D = uWA[i].xy; float k = uWA[i].z; float A = uWA[i].w * uAmp;
    float L = uWB[i].w;
    A *= 1.0 - smoothstep(L * 5.0, L * 20.0, dist);
    float Q = uWB[i].y * uChoppy;
    float th = k * dot(D, p) - uWB[i].x * uTime + uWB[i].z;
    float c = cos(th), s = sin(th);
    disp += vec3(Q * A * D.x * c, A * s, Q * A * D.y * c);
    float WA = k * A;
    nx += D.x * WA * c; nz += D.y * WA * c; ny += Q * WA * s;
  }
  vec3 pos = wp + disp;
  vec2 rel = pos.xz - cameraPosition.xz;
  pos.y -= dot(rel, rel) / (2.0 * uEarthR);
  vWorld = pos; vNrm = normalize(vec3(-nx, 1.0 - ny, -nz)); vHeight = disp.y; vDist = dist; vCrest = ny;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform samplerCube uEnv; uniform sampler2D uNormalTex;
uniform vec3 uSunDir, uSunColor, uDeep, uScatter, uFogColor, uUwFog;
uniform float uFogDensity, uUwDensity, uTime, uFoam, uEnvIntensity, uExposureFix, uAmp;
uniform vec4 uSpots[${MAXSPOTS}]; uniform int uSpotCount;
uniform vec4 uTrail[${MAXTRAIL}]; uniform int uTrailCount;
uniform vec4 uLights[${MAXLIGHTS}]; uniform vec3 uLightCol[${MAXLIGHTS}]; uniform int uLightCount;
uniform vec4 uHull; uniform float uHullOn; uniform vec3 uMoonDir, uMoonCol;
varying vec3 vWorld; varying vec3 vNrm; varying float vHeight; varying float vDist; varying float vCrest;

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  #include <logdepthbuf_fragment>
  // keep the sea out of the vessel's hull (its deck stays dry as it pitches through the waves)
  if (uHullOn > 0.5) {
    vec2 d = vWorld.xz - uHull.xy;
    float lx = d.x * uHull.z - d.y * uHull.w, lz = d.x * uHull.w + d.y * uHull.z;
    float halfW = 9.0 * sqrt(clamp((lz + 40.0) / 22.0, 0.0, 1.0));
    if (lz > -40.0 && lz < 36.0 && abs(lx) < halfW) discard;
  }
  vec3 V = normalize(cameraPosition - vWorld);
  vec2 uv1 = vWorld.xz * 0.06 + vec2(uTime * 0.021, uTime * 0.014);
  vec2 uv2 = vWorld.xz * 0.17 - vec2(uTime * 0.018, -uTime * 0.027);
  vec3 n1 = texture2D(uNormalTex, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormalTex, uv2).xyz * 2.0 - 1.0;
  float detail = (1.0 - smoothstep(40.0, 900.0, vDist)) * 0.5 + 0.06;
  vec3 N = normalize(vNrm + vec3(n1.x + n2.x, 0.0, n1.y + n2.y) * detail * (0.45 + 0.35 * uAmp));
  float noiseA = texture2D(uNormalTex, vWorld.xz * 0.045 + uTime * 0.006).x;
  float noiseB = texture2D(uNormalTex, vWorld.xz * 0.21 - uTime * 0.01).y;
  float fnoise = clamp(noiseA * 0.6 + noiseB * 0.6 - 0.15, 0.0, 1.0);
  vec3 col;

  if (gl_FrontFacing) {
    // ---------------- seen from above
    float NdV = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.01;
    float lod = clamp(vDist / 1500.0, 0.0, 1.0) * 3.0 + 0.5;
    vec3 sky = textureLod(uEnv, R, lod).rgb * uEnvIntensity;
    vec3 amb = textureLod(uEnv, vec3(0.0, 1.0, 0.0), 6.0).rgb * uEnvIntensity;
    float sunUp = clamp(uSunDir.y * 3.0, 0.0, 1.0);
    float shin = mix(1400.0, 160.0, clamp(vDist / 2500.0, 0.0, 1.0));
    float spec = pow(max(dot(R, uSunDir), 0.0), shin) * mix(18.0, 5.0, clamp(vDist / 2500.0, 0.0, 1.0)) * sunUp;
    float sss = pow(max(dot(V, normalize(-uSunDir + N * 0.5)), 0.0), 3.0) * clamp(vHeight * 0.7 + 0.35, 0.0, 1.0);
    vec3 water = uDeep * (vec3(0.1 + 0.25 * sunUp) + amb * 0.9 + uSunColor * sunUp * 0.3) + uScatter * (sss * uSunColor * 0.55 + amb * 0.05) * (1.0 - smoothstep(200.0, 3000.0, vDist));
    col = mix(water, sky, F) + uSunColor * spec;
    // moon glitter path
    float moonUp = clamp(uMoonDir.y * 4.0, 0.0, 1.0);
    col += uMoonCol * pow(max(dot(R, uMoonDir), 0.0), shin * 0.3) * 7.0 * moonUp * (1.0 - smoothstep(1500.0, 9000.0, vDist));
    // reflections of lights at night (flare, deck lights, vessel)
    for (int i = 0; i < ${MAXLIGHTS}; i++) {
      if (i >= uLightCount) break;
      vec3 Lp = uLights[i].xyz - vWorld; float d = length(Lp);
      float s = pow(max(dot(R, Lp / d), 0.0), 90.0);
      col += uLightCol[i] * s * uLights[i].w / (1.0 + d * d * 0.00002);
      col += uLightCol[i] * uLights[i].w * 0.02 / (1.0 + d * d * 0.004);
    }
    // foam: breaking crests, contact with structures, vessel wake
    float foam = smoothstep(mix(0.95, 0.42, uFoam), mix(1.25, 0.72, uFoam), vCrest + fnoise * 0.3) * (0.4 + fnoise);
    for (int i = 0; i < ${MAXSPOTS}; i++) {
      if (i >= uSpotCount) break;
      float d = length(vWorld.xz - uSpots[i].xy);
      foam += smoothstep(uSpots[i].z, uSpots[i].z * 0.25, d) * uSpots[i].w * (0.35 + fnoise * 0.9);
    }
    for (int i = 0; i < ${MAXTRAIL} - 1; i++) {
      if (i >= uTrailCount - 1) break;
      vec4 a = uTrail[i], b = uTrail[i + 1];
      float d = segDist(vWorld.xz, a.xy, b.xy);
      float w = mix(a.z, b.z, 0.5);
      float edge = smoothstep(w, w * 0.55, d) * (1.0 - smoothstep(w * 0.55, 0.0, d) * 0.55);
      foam += edge * mix(a.w, b.w, 0.5) * smoothstep(0.15, 0.75, fnoise);
    }
    foam = clamp(foam, 0.0, 1.0) * (1.0 - smoothstep(600.0, 3000.0, vDist));
    vec3 foamCol = amb * 0.9 + uSunColor * (0.25 + sunUp * 0.6) * 0.8;
    col = mix(col, foamCol, foam * 0.85);
    // aerial perspective: blend toward the sky colour at the horizon
    vec3 horizon = textureLod(uEnv, normalize(vec3(-V.x, 0.03, -V.z)), 3.0).rgb * uEnvIntensity;
    vec3 fogC = mix(uFogColor, horizon, 0.6);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
    col = mix(col, fogC, clamp(fogF, 0.0, 1.0));
  } else {
    // ---------------- seen from below: Snell's window and total internal reflection
    vec3 D = -V;                         // view ray, pointing up toward the surface
    vec3 Nb = -N;                        // surface normal facing down
    float cosI = clamp(dot(D, -Nb), 0.0, 1.0);
    float sinT = sqrt(max(0.0, 1.0 - cosI * cosI)) * 1.333;
    float window = 1.0 - smoothstep(0.92, 1.0, sinT);
    vec3 T = refract(D, Nb, 1.333);
    vec3 skyT = textureLod(uEnv, normalize(T + vec3(0.0, 0.001, 0.0)), 1.0).rgb * uEnvIntensity;
    float sunT = pow(max(dot(normalize(T), uSunDir), 0.0), 300.0) * 12.0;
    vec3 through = (skyT + uSunColor * sunT) * 0.9;
    vec3 tir = uUwFog * 1.1;
    col = mix(tir, through, window);
    float fogF = 1.0 - exp(-uUwDensity * vDist);
    col = mix(col, uUwFog, clamp(fogF, 0.0, 1.0));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Ocean {
  constructor(ctx, waves, envTexture) {
    this.ctx = ctx; this.waves = waves;
    this.normalTex = waterNormalTexture(256);
    this.uniforms = {
      uWA: { value: Array.from({ length: MAXW }, () => new THREE.Vector4()) },
      uWB: { value: Array.from({ length: MAXW }, () => new THREE.Vector4()) },
      uWaveCount: { value: 0 }, uTime: { value: 0 }, uAmp: { value: 1 }, uChoppy: { value: 1 }, uEarthR: { value: CONFIG.earthRadius },
      uEnv: { value: envTexture }, uNormalTex: { value: this.normalTex },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
      uDeep: { value: new THREE.Color(0x06303a) }, uScatter: { value: new THREE.Color(0x1aa59a) },
      uFogColor: { value: new THREE.Color(0xc9c2b0) }, uUwFog: { value: new THREE.Color(0x1c5a64) },
      uFogDensity: { value: CONFIG.fogAboveDensity }, uUwDensity: { value: CONFIG.fogBelowDensity },
      uFoam: { value: 0.5 }, uEnvIntensity: { value: 1 }, uExposureFix: { value: 1 },
      uSpots: { value: Array.from({ length: MAXSPOTS }, () => new THREE.Vector4()) }, uSpotCount: { value: 0 },
      uTrail: { value: Array.from({ length: MAXTRAIL }, () => new THREE.Vector4()) }, uTrailCount: { value: 0 },
      uLights: { value: Array.from({ length: MAXLIGHTS }, () => new THREE.Vector4()) },
      uLightCol: { value: Array.from({ length: MAXLIGHTS }, () => new THREE.Color()) }, uLightCount: { value: 0 },
      uHull: { value: new THREE.Vector4() }, uHullOn: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonCol: { value: new THREE.Color(0, 0, 0) }
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, toneMapped: true });
    this.mesh = null;
    this.spots = []; this.trails = [];
    this.setResolution(ctx.quality.tier);
    this.syncWaves();
  }

  setResolution(tier) {
    if (this.mesh) { this.mesh.geometry.dispose(); }
    const geo = oceanGeometry(tier.oceanRadial, tier.oceanNear, 90000);
    if (!this.mesh) { this.mesh = new THREE.Mesh(geo, this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = -1; }
    else this.mesh.geometry = geo;
  }

  syncWaves() {
    const w = this.waves.list;
    w.forEach((v, i) => {
      this.uniforms.uWA.value[i].set(v.dx, v.dz, v.k, v.A);
      this.uniforms.uWB.value[i].set(v.w, v.q, v.phase, v.L);
    });
    this.uniforms.uWaveCount.value = w.length;
    this.uniforms.uAmp.value = this.waves.amp; this.uniforms.uChoppy.value = this.waves.choppy;
    this.uniforms.uFoam.value = this.waves.foam ?? 0.5;
  }

  setLook(preset, sky) {
    const u = this.uniforms;
    u.uSunDir.value.copy(sky.sunDir);
    u.uSunColor.value.copy(sky.sun.color).multiplyScalar(Math.max(preset.sun, 0.05) * 0.9);
    u.uFogColor.value.setHex(preset.fog);
    u.uUwFog.value.setHex(preset.uwFog);
    u.uEnvIntensity.value = 1.0;   // the reflected sky must match the visible sky
    const night = preset.elevation < 0;
    u.uDeep.value.setHex(night ? 0x031018 : preset.elevation < 5 ? 0x123c46 : 0x0d4552);
    u.uScatter.value.setHex(night ? 0x041a1c : 0x19a394);
  }

  // Foam spots (x, z, radius, strength) for legs / hulls; trails: arrays of {x, z, w, s}
  setSpots(spots) {
    const u = this.uniforms; const n = Math.min(spots.length, MAXSPOTS);
    for (let i = 0; i < n; i++) u.uSpots.value[i].set(spots[i][0], spots[i][1], spots[i][2], spots[i][3]);
    u.uSpotCount.value = n;
  }
  setHull(on, x, z, heading) {
    const u = this.uniforms; u.uHullOn.value = on ? 1 : 0;
    if (on) u.uHull.value.set(x, z, Math.cos(heading), Math.sin(heading));
  }
  setMoon(dir, color) { this.uniforms.uMoonDir.value.copy(dir); this.uniforms.uMoonCol.value.copy(color); }
  setTrail(points) {
    const u = this.uniforms; const n = Math.min(points.length, MAXTRAIL);
    for (let i = 0; i < n; i++) u.uTrail.value[i].set(points[i].x, points[i].z, points[i].w, points[i].s);
    u.uTrailCount.value = n;
  }
  setLights(list) {
    const u = this.uniforms; const n = Math.min(list.length, MAXLIGHTS);
    for (let i = 0; i < n; i++) { u.uLights.value[i].set(list[i].p.x, list[i].p.y, list[i].p.z, list[i].i); u.uLightCol.value[i].copy(list[i].c); }
    u.uLightCount.value = n;
  }

  update(t, camera) {
    this.uniforms.uTime.value = t;
    this.mesh.position.set(Math.round(camera.position.x), 0, Math.round(camera.position.z));
  }
}
