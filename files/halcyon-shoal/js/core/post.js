// Post-processing chain: render -> bloom -> final grade (vignette, flare heat haze, underwater softening,
// lens droplets after surfacing) -> tone mapping + sRGB -> anti-aliasing.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uHaze: { value: new THREE.Vector3(0.5, 0.5, 0) }, uHazeOn: { value: 0 },
    uUnder: { value: 0 }, uDrops: { value: 0 }, uVignette: { value: 0.28 }, uGrade: { value: new THREE.Vector3(1.02, 1.0, 0.97) }
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform vec3 uHaze; uniform float uHazeOn;
    uniform float uUnder; uniform float uDrops; uniform float uVignette; uniform vec3 uGrade;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
    void main() {
      vec2 uv = vUv;
      // heat shimmer in a column above the flare (uHaze.xy = screen position, z = radius)
      if (uHazeOn > 0.5) {
        vec2 d = (uv - uHaze.xy) * vec2(uRes.x / uRes.y, 1.0);
        float col = exp(-pow(d.x / (uHaze.z * 0.7), 2.0)) * smoothstep(-uHaze.z * 0.3, uHaze.z * 0.6, d.y) * (1.0 - smoothstep(uHaze.z * 1.5, uHaze.z * 3.5, d.y));
        uv += vec2(sin(uv.y * 160.0 - uTime * 9.0), cos(uv.x * 140.0 + uTime * 7.0)) * 0.0016 * col;
      }
      // water droplets on the lens just after surfacing
      if (uDrops > 0.0) {
        vec2 g = floor(uv * vec2(18.0, 11.0)); vec2 f = fract(uv * vec2(18.0, 11.0)) - 0.5;
        float h = hash(g); vec2 o = vec2(hash(g + 3.1), hash(g + 7.7)) - 0.5;
        float r = length(f - o * 0.5);
        float drop = step(h, 0.35) * (1.0 - smoothstep(0.12, 0.2, r)) * uDrops;
        uv += (f - o * 0.5) * drop * 0.05;
      }
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (uUnder > 0.5) {   // slight softness underwater
        vec2 px = 1.5 / uRes;
        c = c * 0.5 + (texture2D(tDiffuse, uv + px).rgb + texture2D(tDiffuse, uv - px).rgb + texture2D(tDiffuse, uv + vec2(px.x, -px.y)).rgb + texture2D(tDiffuse, uv - vec2(px.x, -px.y)).rgb) * 0.125;
      }
      c *= uGrade;
      float v = length((vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.35, 1.05, v);
      gl_FragColor = vec4(c, 1.0);
    }`
};

export class Post {
  constructor(renderer, scene, camera, tier) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.render = new RenderPass(scene, camera);
    this.composer.addPass(this.render);
    // keep extreme highlights (the sun disc) from flooding the bloom
    this.clamp = new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: FinalShader.vertexShader,
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec3 c = texture2D(tDiffuse, vUv).rgb; gl_FragColor = vec4(min(c, vec3(6.0)), 1.0); }' });
    this.composer.addPass(this.clamp);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.45, 1.1);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.fxaa = new FXAAPass(); this.smaa = new SMAAPass();
    this.composer.addPass(this.fxaa); this.composer.addPass(this.smaa);
    this.setTier(tier);
  }

  setTier(tier) {
    this.bloom.enabled = tier.bloom;
    this.fxaa.enabled = tier.aa === 'fxaa';
    this.smaa.enabled = tier.aa === 'smaa';
    this.hazeAllowed = tier.haze;
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.final.uniforms.uRes.value.set(w * pr, h * pr);
  }

  update(dt, t, opts) {
    const u = this.final.uniforms;
    u.uTime.value = t;
    u.uUnder.value = opts.under ? 1 : 0;
    u.uDrops.value = Math.max(0, u.uDrops.value - dt * 0.35);
    if (opts.surfaced) u.uDrops.value = 1;
    u.uHazeOn.value = this.hazeAllowed && opts.haze ? 1 : 0;
    if (opts.haze) u.uHaze.value.copy(opts.haze);
    this.bloom.strength = 0.22 + opts.night * 0.3;
    this.bloom.threshold = 1.5 / Math.max(0.2, this.renderer.toneMappingExposure);   // only lights, flare and the sun glint bloom
  }
}
