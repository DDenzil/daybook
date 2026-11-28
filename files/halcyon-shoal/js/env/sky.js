// Physically based sky with clouds, sun and moon light, stars, and environment lighting.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CONFIG } from '../config.js';
import { shared } from '../core/materials.js';

export class SkySystem {
  constructor(ctx) {
    this.ctx = ctx;
    const { renderer } = ctx;
    this.sky = new Sky();
    this.sky.scale.setScalar(100000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    for (const s of [this.sky]) {   // fade clouds well above the horizon so they never read as distant land
      s.material.fragmentShader = s.material.fragmentShader.replace('smoothstep( 0.0, 0.03 + 0.06 * cloudElevation, direction.y )', 'smoothstep( 0.05, 0.3, direction.y )');
    }

    // A second sky in its own scene, rendered into a cube map for reflections and image-based light
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(1500); this.envScene.add(this.envSky);
    this.envSky.material.fragmentShader = this.envSky.material.fragmentShader.replace('smoothstep( 0.0, 0.03 + 0.06 * cloudElevation, direction.y )', 'smoothstep( 0.05, 0.3, direction.y )');
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(1, 5000, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    const sc = this.sun.shadow.camera; sc.near = 10; sc.far = 900; sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110;
    this.moon = new THREE.DirectionalLight(0x9db4ff, 0);
    this.hemi = new THREE.HemisphereLight(0xdfe8f2, 0x2a3c44, 0.5);
    this.group = new THREE.Group();
    this.group.add(this.sky, this.sun, this.sun.target, this.moon, this.moon.target, this.hemi);
    this.stars = makeStars(); this.group.add(this.stars);
    // night sky: Milky Way and the moon at today's real phase
    this.milky = makeMilkyWay(); this.moonMesh = makeMoon();
    this.nightGroup = new THREE.Group(); this.nightGroup.add(this.milky, this.moonMesh.mesh, this.moonMesh.halo);
    this.group.add(this.nightGroup);
    this.moonDir = new THREE.Vector3(0, -1, 0); this.moonInfo = moonPhase(new Date());
    this.preset = null;
    this.night = 0;
  }

  setShadowSize(size) {
    if (!size) { this.sun.castShadow = false; return; }
    this.sun.castShadow = true;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  apply(name, scene) {
    const p = CONFIG.timeOfDay[name] || CONFIG.timeOfDay.golden;
    this.preset = p; this.presetName = name;
    const el = THREE.MathUtils.degToRad(p.elevation), az = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh; u.mieCoefficient.value = p.mie;
      u.mieDirectionalG.value = 0.82; u.sunPosition.value.copy(this.sunDir);
      u.cloudCoverage.value = name === 'night' ? 0.12 : 0.26; u.cloudDensity.value = 0.32; u.cloudScale.value = 0.00022; u.cloudElevation.value = 1.0;
    }
    const sunCol = new THREE.Color().setHSL(0.09, 0.55, 0.5 + Math.min(1, Math.max(0, p.elevation) / 40) * 0.5);
    if (p.elevation < 12) sunCol.lerp(new THREE.Color(1.0, 0.62, 0.38), 1 - Math.max(0, p.elevation) / 12);
    this.sun.color.copy(sunCol); this.sun.intensity = p.sun;
    this.sun.visible = p.sun > 0.01;
    this.moon.intensity = p.moon || 0;
    this.hemi.intensity = p.hemi;
    this.night = name === 'night' ? 1 : name === 'dusk' ? 0.65 : 0;
    this.stars.material.opacity = name === 'night' ? 0.9 : name === 'dusk' ? 0.15 : 0;
    this.stars.visible = this.stars.material.opacity > 0;
    this.setupNight(name, p);
    this.ctx.renderer.toneMappingExposure = p.exposure;
    shared.uSunDir.value.copy(this.sunDir);
    shared.uSunColor.value.copy(this.sun.color).multiplyScalar(Math.max(p.sun, (p.moon || 0) * 2) * 0.35);
    this.updateEnvironment(scene);
  }

  // Moon placed from today's phase: its elongation from the sun, rotated about the celestial pole
  // (latitude ~25 N). A moon that is not yet up at this hour is shown as it appears later tonight.
  setupNight(name, p) {
    const info = this.moonInfo = moonPhase(new Date());
    const nightF = name === 'night' ? 1 : name === 'dusk' ? 0.25 : 0;
    this.milky.material.uniforms.uOpacity.value = name === 'night' ? 1 : 0;
    this.milky.visible = name === 'night';
    const pole = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(25)), -Math.cos(THREE.MathUtils.degToRad(25)));
    let sun = this.sunDir.clone(), m = sun.clone().applyAxisAngle(pole, info.elong);
    info.later = false;
    if (Math.asin(m.y) < THREE.MathUtils.degToRad(18)) {
      for (let h = 0; h < 360; h += 2) {          // let the sky turn (westward) until the moon is well up
        const r = -THREE.MathUtils.degToRad(h), mm = m.clone().applyAxisAngle(pole, r);
        if (Math.asin(mm.y) > THREE.MathUtils.degToRad(32)) { m = mm; sun = sun.applyAxisAngle(pole, r); info.later = h > 0; break; }
      }
    }
    this.moonDir.copy(m);
    const visible = nightF > 0 && info.illum > 0.03 && m.y > 0;
    const mm = this.moonMesh;
    mm.mesh.visible = mm.halo.visible = visible;
    // light direction on the moon: in the plane of moon and sun, at the true phase angle
    const phaseAng = Math.PI - info.elong;
    const sp = sun.clone().addScaledVector(m, -sun.dot(m)).normalize();
    const L = m.clone().multiplyScalar(-Math.cos(phaseAng)).addScaledVector(sp, Math.sin(phaseAng)).normalize();
    mm.mesh.material.uniforms.uLight.value.copy(L);
    mm.mesh.material.uniforms.uBright.value = (name === 'night' ? 1.2 : 0.6) / p.exposure;    // below the bloom threshold so the phase stays readable
    mm.halo.material.opacity = 0.16 * info.illum * nightF;
    this.moon.intensity = visible ? (p.moon || 0.04) * (0.25 + 0.75 * info.illum) * 1.6 : 0;
    this.moonVisible = visible;
    this.moonGlitter = new THREE.Color(0.75, 0.82, 1.0).multiplyScalar(visible ? info.illum * 0.6 * nightF : 0);
  }

  updateEnvironment(scene) {
    const r = this.ctx.renderer;
    this.cubeCam.update(r, this.envScene);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture);
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = this.preset.env;
    this.envNeedsTime = 0;
  }

  update(dt, camera, target) {
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    const t = this.sky.material.uniforms.time; t.value += dt;
    this.envSky.material.uniforms.time.value = t.value;
    // keep the shadow camera on the area being looked at (snapped to texels to avoid shimmer)
    const s = this.sun, d = this.sunDir.y > 0.05 ? this.sunDir : new THREE.Vector3(0.3, 0.8, 0.2).normalize();
    const size = s.shadow.mapSize.x || 2048;
    const span = (s.shadow.camera.right - s.shadow.camera.left) / size;
    const tx = Math.round(target.x / span) * span, tz = Math.round(target.z / span) * span;
    s.target.position.set(tx, Math.max(0, target.y * 0.5), tz);
    s.position.copy(s.target.position).addScaledVector(d, 450);
    this.moon.position.copy(target).addScaledVector(this.moonVisible ? this.moonDir : new THREE.Vector3(-0.4, 0.8, 0.3).normalize(), 600);
    this.moon.target.position.copy(target);
    this.nightGroup.position.copy(camera.position);
    const mm = this.moonMesh;
    mm.mesh.position.copy(this.moonDir).multiplyScalar(30000);
    mm.halo.position.copy(this.moonDir).multiplyScalar(29800);
  }
}

function makeStars() {
  const n = 1800, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random(), v = Math.random() * 0.95 + 0.04;
    const th = u * Math.PI * 2, ph = Math.acos(1 - v);
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * 30000; pos[i * 3 + 1] = Math.cos(ph) * 30000; pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 30000;
    const b = 0.5 + Math.random() * 0.5; col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b * (0.9 + Math.random() * 0.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -9;
  return p;
}

// ---------------------------------------------------------------- moon phase
// Mean synodic month from a known new moon (2000-01-06 18:14 UTC). Accurate to about half a day.
export function moonPhase(date) {
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  const f = ((days / 29.530588853) % 1 + 1) % 1;
  const illum = (1 - Math.cos(2 * Math.PI * f)) / 2;
  const names = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];
  const name = names[Math.round(f * 8) % 8];
  return { f, illum, elong: 2 * Math.PI * f, name };
}

const LOGDEPTH_V = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
const LOGDEPTH_F = '#include <common>\n#include <logdepthbuf_pars_fragment>\n';

// Galactic plane: a band tilted across the sky, its bright core low in the south-west
const GAL_N = new THREE.Vector3(0.62, 0.42, -0.66).normalize();
const GAL_C = new THREE.Vector3(-0.55, 0.12, 0.83).projectOnPlane(GAL_N).normalize();

function makeMilkyWay() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uN: { value: GAL_N }, uC: { value: GAL_C } },
    vertexShader: LOGDEPTH_V + `varying vec3 vDir;
      void main() { vDir = normalize(position); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGDEPTH_F + `uniform float uOpacity; uniform vec3 uN, uC; varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }
      void main() {
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vDir);
        float b = dot(d, uN);
        float core = pow(max(dot(d, uC), 0.0), 8.0);
        float wob = (fbm(d * 3.0) - 0.5) * 0.05;                       // the band meanders a little
        float bb = b + wob;
        float width = 0.055 + core * 0.09;
        float band = exp(-bb * bb / (width * width));
        float halo = exp(-bb * bb / (width * width * 6.0)) * 0.18;     // faint wide glow
        float n = fbm(d * 9.0), n2 = fbm(d * 31.0 + 3.1), grain = noise(d * 140.0);
        float clouds = smoothstep(0.35, 0.85, n) * 0.8 + 0.2;
        float glow = band * clouds * (0.6 + core * 2.2) + halo;
        float dust = smoothstep(0.45, 0.7, fbm(d * 14.0 + 7.0)) * exp(-bb * bb / (width * width * 0.18));   // dark lanes along the plane
        glow *= 1.0 - dust * 0.85;
        glow *= 0.65 + 0.7 * pow(n2, 1.5) + 0.35 * grain;                                                  // star clouds and grain
        float horizon = smoothstep(0.03, 0.35, d.y);
        vec3 col = mix(vec3(0.72, 0.78, 0.95), vec3(0.98, 0.9, 0.78), clamp(core * 2.5, 0.0, 1.0));
        gl_FragColor = vec4(col * glow * 0.06 * horizon * uOpacity, 1.0);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(32000, 64, 32), mat);
  m.frustumCulled = false; m.renderOrder = -9; m.visible = false;
  return m;
}

function makeMoon() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLight: { value: new THREE.Vector3(0, 0, 1) }, uBright: { value: 2 } },
    vertexShader: LOGDEPTH_V + `varying vec3 vN, vP;
      void main() { vN = normalize(normal); vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGDEPTH_F + `uniform vec3 uLight; uniform float uBright; varying vec3 vN, vP;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(vN);
        float lit = smoothstep(-0.03, 0.08, dot(n, uLight));
        vec3 q = n * 3.0;
        float maria = smoothstep(0.45, 0.7, noise(q) * 0.6 + noise(q * 2.3) * 0.4);
        float crater = noise(n * 22.0) * 0.12;
        float albedo = 0.95 - maria * 0.38 + crater;
        vec3 col = vec3(0.98, 0.96, 0.9) * albedo * (lit + 0.012) * uBright;
        gl_FragColor = vec4(col, 1.0);
      }`,
    fog: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(180, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -8; mesh.visible = false;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0xbfd0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 }));
  halo.scale.setScalar(2600); halo.renderOrder = -8; halo.visible = false; halo.frustumCulled = false;
  return { mesh, halo };
}

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
