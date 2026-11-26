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
    this.ctx.renderer.toneMappingExposure = p.exposure;
    shared.uSunDir.value.copy(this.sunDir);
    shared.uSunColor.value.copy(this.sun.color).multiplyScalar(Math.max(p.sun, (p.moon || 0) * 2) * 0.35);
    this.updateEnvironment(scene);
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
    this.moon.position.set(camera.position.x - 300, 600, camera.position.z + 200);
    this.moon.target.position.copy(camera.position);
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
