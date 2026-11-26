// Material post-processing for loaded models. Behaviour is chosen from the Blender material name
// (see tools/blender/kit.py): weathering, splash-zone growth, underwater caustics, night lights.
import * as THREE from 'three';
import { grimeTexture, windowMaskTexture } from './noise.js';

export const shared = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uCaustic: { value: 1.0 },
  uWaterLevel: { value: 0 },
  uGrimeTex: { value: null },
  uGrimeAmt: { value: 1.0 },
  uRustAmt: { value: 1.0 }
};

const lights = { emissive: [], windows: [], night: 0 };
let windowMask = null;

export function initMaterials() {
  shared.uGrimeTex.value = grimeTexture(256);
  windowMask = windowMaskTexture();
}

const GLSL_COMMON = /* glsl */`
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uCaustic; uniform float uWaterLevel;
uniform sampler2D uGrimeTex; uniform float uGrimeAmt; uniform float uRustAmt;
varying vec3 vWPos; varying vec3 vWNrm;
float hsCaustic(vec2 p, float t) {
  vec2 q = p; float c = 0.0;
  for (int i = 0; i < 3; i++) {
    q += vec2(sin(q.y * 1.3 + t * 0.9), cos(q.x * 1.1 - t * 0.7)) * 0.55;
    c += 1.0 / (1.0 + abs(sin(q.x + q.y)) * 9.0);
    q *= 1.63;
  }
  return pow(c / 3.0, 2.2) * 4.0;
}
`;

export function patchMaterial(mat, flags) {
  const key = Object.keys(flags).filter(k => flags[k]).sort().join(',');
  if (!key) return;
  mat.customProgramCacheKey = () => 'hs:' + key;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 hsWp = vec4(transformed, 1.0);
        vec3 hsN = objectNormal;
        #ifdef USE_INSTANCING
          hsWp = instanceMatrix * hsWp; hsN = mat3(instanceMatrix) * hsN;
        #endif
        hsWp = modelMatrix * hsWp;
        vWPos = hsWp.xyz; vWNrm = normalize(mat3(modelMatrix) * hsN);`);
    let fs = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_COMMON);
    if (flags.grime || flags.splash) {
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 hsAn = abs(vWNrm);
        vec2 hsUv = hsAn.y > max(hsAn.x, hsAn.z) ? vWPos.xz : (hsAn.x > hsAn.z ? vWPos.zy : vWPos.xy);
        vec4 hsG = texture2D(uGrimeTex, hsUv * 0.09);
        float hsStreak = texture2D(uGrimeTex, vec2(hsUv.x * 0.31, hsUv.y * 0.045)).g;
        float hsGrime = hsG.r * uGrimeAmt;
        diffuseColor.rgb *= mix(1.0, 0.7, hsGrime);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.16, 0.08), smoothstep(0.45, 1.0, hsStreak) * 0.55 * uRustAmt);
        float hsWet = 0.0;
        ${flags.splash ? `
        hsWet = smoothstep(5.0, 0.3, vWPos.y);
        diffuseColor.rgb *= mix(1.0, 0.6, hsWet);
        float hsGn = texture2D(uGrimeTex, hsUv * 0.6).b;
        float hsGrow = smoothstep(1.2, -1.2, vWPos.y) * smoothstep(-26.0, -5.0, vWPos.y);
        vec3 hsGrowCol = mix(vec3(0.10, 0.14, 0.08), vec3(0.30, 0.27, 0.18), hsGn);
        diffuseColor.rgb = mix(diffuseColor.rgb, hsGrowCol, clamp(hsGrow * (0.55 + hsGn * 0.7), 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.13, 0.12), smoothstep(-26.0, -40.0, vWPos.y) * 0.5);` : ''}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + hsGrime * 0.18 - hsWet * 0.3, 0.04, 1.0);`);
    }
    if (flags.caustic) {
      fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (vWPos.y < uWaterLevel) {
          float hsD = uWaterLevel - vWPos.y;
          vec2 hsP = vWPos.xz * 0.32 + uSunDir.xz * hsD * 0.25;
          float hsC = hsCaustic(hsP, uTime * 1.2);
          float hsUp = clamp(vWNrm.y * 0.6 + 0.45, 0.0, 1.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * hsC * hsUp * exp(-hsD * 0.07) * uCaustic * 0.6;
        }`);
    }
    shader.fragmentShader = fs;
  };
  mat.needsUpdate = true;
}

// Walk a loaded model and prepare its materials. Materials are shared across clones.
const done = new WeakSet();
export function processModel(root, opts = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = opts.castShadow !== false;
    o.receiveShadow = opts.receiveShadow !== false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => prepare(m, opts));
  });
}

function prepare(m, opts) {
  if (!m || done.has(m)) return;
  done.add(m);
  const n = (m.name || '').toLowerCase();
  if (m.aoMap) m.aoMapIntensity = 0.95;
  if (n.startsWith('grating') || n.startsWith('net')) {
    m.alphaTest = 0.45; m.transparent = false; m.side = THREE.DoubleSide;
    if (m.map) m.map.anisotropy = 4;
  }
  if (n.startsWith('glass')) {
    m.metalness = 0.85; m.roughness = 0.06; m.envMapIntensity = 1.5;
    if (n === 'glass_tint') { m.transparent = true; m.opacity = 0.55; m.depthWrite = false; m.side = THREE.DoubleSide; }
  }
  if (n === 'rotor_blur') { m.transparent = true; m.depthWrite = false; m.side = THREE.DoubleSide; m.alphaTest = 0; }
  if (n.startsWith('emit_window')) {
    m.emissive = new THREE.Color(0xffd29a); m.emissiveMap = windowMask; m.emissiveIntensity = 0;
    lights.windows.push(m);
  } else if (n.startsWith('emit_')) {
    m.userData.baseEmissive = m.emissive.clone();
    m.userData.aviation = n === 'emit_red';
    lights.emissive.push(m);
  }
  if (n.startsWith('helideck')) { m.roughness = 0.75; }
  if (n.startsWith('creature_')) { m.roughness = Math.max(m.roughness, 0.45); }
  const grime = /^(paint_|steel_|pipe_|cladding_|galv|hull_|deck_|tank_|concrete)/.test(n);
  const splash = n.startsWith('jacket') || n.startsWith('anode');
  if (opts.weather !== false) patchMaterial(m, { grime: grime || splash, splash, caustic: opts.caustic !== false });
}

// 0 = full day, 1 = full night. Lights fade in through dusk.
export function setNight(f) {
  lights.night = f;
  for (const m of lights.emissive) {
    const base = m.userData.baseEmissive;
    const k = m.userData.aviation ? 0.6 + f * 1.4 : f * 1.5;
    m.emissive.copy(base); m.emissiveIntensity = k;
  }
  for (const m of lights.windows) m.emissiveIntensity = f * 1.3;
}
