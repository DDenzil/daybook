// Halcyon Shoal — boot sequence and render loop.
import * as THREE from 'three';
import { CONFIG, loadSettings } from './config.js';
import { Quality, safeGet, safeSet } from './core/quality.js';
import { Assets } from './core/assets.js';
import { initMaterials, shared, setNight } from './core/materials.js';
import { Post } from './core/post.js';
import { SkySystem } from './env/sky.js';
import { Waves, Ocean } from './env/ocean.js';
import { Underwater } from './env/underwater.js';
import { Seabed } from './env/seabed.js';
import { Field } from './assets/field.js';
import { Shore } from './assets/shore.js';
import { Vessel, Helicopter } from './sim/logistics.js';
import { Telemetry } from './sim/telemetry.js';
import { Marine } from './life/marine.js';
import { CameraRig } from './ui/camera.js';
import { HUD } from './ui/hud.js';
import { FieldMap } from './ui/fieldmap.js';
import { AudioSystem } from './audio/audio.js';

const loadBar = document.getElementById('load-bar');
const loadText = document.getElementById('load-text');
const progress = (f, msg) => { loadBar.style.width = Math.round(f * 100) + '%'; if (msg) loadText.textContent = msg; };

class Events { constructor() { this.h = {}; } on(k, f) { (this.h[k] ||= []).push(f); } emit(k, v) { (this.h[k] || []).forEach((f) => f(v)); } }

async function boot() {
  const settings = await loadSettings();
  progress(0.04, 'Starting the renderer…');
  const renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', stencil: false });
  if (!renderer.capabilities.isWebGL2) { loadText.textContent = 'This browser does not support WebGL 2.'; return; }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('viewport').appendChild(renderer.domElement);

  const quality = new Quality(renderer);
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, innerWidth / innerHeight, CONFIG.camera.near, CONFIG.camera.far);
  camera.position.set(-620, 260, 520);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xc9c2b0, CONFIG.fogAboveDensity);
  scene.add(camera);

  const d = settings.defaults;
  const ctx = {
    renderer, camera, scene, quality, settings, events: new Events(),
    state: { timeOfDay: safeGet('hs.tod') || d.timeOfDay, seaState: safeGet('hs.sea') || d.seaState, simSpeed: d.simSpeed, labels: (safeGet('hs.labels') || (d.labels ? 'on' : 'off')) === 'on', selected: null, addMode: false },
    wind: { dir: THREE.MathUtils.degToRad(135), speed: 9 }, night: 0, timeUniform: shared.uTime
  };
  window.HS = ctx;  // handy for debugging in the console

  initMaterials();
  ctx.assets = new Assets(renderer, (f, url) => progress(0.1 + f * 0.75, 'Loading ' + url.replace('models/', '')));

  // environment
  ctx.sky = new SkySystem(ctx);
  scene.add(ctx.sky.group);
  ctx.waves = new Waves();
  ctx.waves.setCount(quality.tier.waves);
  ctx.ocean = new Ocean(ctx, ctx.waves, ctx.sky.cubeRT.texture);
  scene.add(ctx.ocean.mesh);
  ctx.underwater = new Underwater(ctx); scene.add(ctx.underwater.group);
  ctx.seabed = new Seabed(ctx); scene.add(ctx.seabed.group);

  // stage 1: the facility
  await ctx.assets.load(['cpp', 'lq', 'bridge', 'whp', 'seabed_props']);
  ctx.field = new Field(ctx);
  await ctx.field.build(settings);
  scene.add(ctx.field.group);
  ctx.telemetry = new Telemetry(ctx);

  // placeholders until stage 2 arrives
  const idle = { root: new THREE.Group(), pos: new THREE.Vector3(), state: 'IDLE', status: () => 'Loading…', trigger: () => false, update() {}, foamSpots: () => [], heading: 0, yaw: 0 };
  ctx.vessel = idle; ctx.heli = { ...idle, root: new THREE.Group() };
  ctx.marine = { sightings: {}, spawnWhaleShark: () => false, spawnWhale: () => false, update() {}, target: () => new THREE.Object3D() };

  ctx.onFieldChanged = () => {
    ctx.seabed.setStructures(ctx.field.structures());
    ctx.seabed.update(camera);
    ctx.colliders = ctx.field.colliders();
    ctx.fieldmap && ctx.fieldmap.draw();
  };
  ctx.seabed.setStructures(ctx.field.structures());
  ctx.colliders = ctx.field.colliders();
  const scatterSites = () => [{ x: 0, z: 0, r: 70 }, { x: CONFIG.lq.x, z: CONFIG.lq.z, r: 50 }, ...ctx.field.wellheads.map((w) => ({ x: w.x, z: w.z, r: 40 }))];
  await ctx.seabed.scatter(ctx.assets, scatterSites(), quality.tierName === 'phone' ? 90 : 220);
  ctx.field.addEventListener('wellheads', () => ctx.seabed.scatter(ctx.assets, scatterSites(), quality.tierName === 'phone' ? 90 : 220));

  ctx.rig = new CameraRig(ctx);
  ctx.rig.controls.target.set(-40, 20, 0);
  ctx.audio = new AudioSystem(ctx);
  ctx.events.on('sound', (e) => ctx.audio.handle(e));
  ctx.post = new Post(renderer, scene, camera, quality.tier);
  ctx.fieldmap = { draw() {}, resize() {} };
  ctx.hud = new HUD(ctx);
  ctx.fieldmap = new FieldMap(ctx);
  ctx.hud.layout();

  // look and feel
  ctx.setTimeOfDay = (name) => {
    ctx.state.timeOfDay = name; safeSet('hs.tod', name);
    const p = CONFIG.timeOfDay[name];
    const active = ctx.activeScene || scene;
    ctx.sky.apply(name, active);
    if (active !== scene) { scene.environment = active.environment; scene.environmentIntensity = active.environmentIntensity; }
    ctx.ocean.setLook(p, ctx.sky);
    ctx.night = ctx.sky.night;
    setNight(ctx.night);
    for (const s of [scene, ctx.shore && ctx.shore.scene].filter(Boolean)) { s.fog.color.setHex(p.fog); }
    if (ctx.underwater.active) ctx.underwater.setActive(true, scene, ctx.sky, p);
    ctx.lampLights.forEach((l) => { l.visible = ctx.night > 0.3; });
  };
  ctx.setSeaState = (name) => {
    ctx.state.seaState = name; safeSet('hs.sea', name);
    const s = CONFIG.seaStates[name];
    ctx.waves.setSeaState(s); ctx.ocean.syncWaves();
    ctx.wind.speed = s.wind;
  };
  // deck lamps (real lights at dusk and night; count limited by tier)
  const nLamps = { phone: 2, pc: 4, plus: 7 }[quality.tierName];
  ctx.lampLights = ctx.field.lamps.slice(0, nLamps).map((p) => { const l = new THREE.PointLight(0xffe2b8, 450, 60, 1.6); l.position.copy(p); scene.add(l); return l; });

  const applyTier = () => {
    const t = quality.tier;
    renderer.setPixelRatio(quality.pixelRatio());
    renderer.setSize(innerWidth, innerHeight);
    ctx.post.setTier(t); ctx.post.setSize(innerWidth, innerHeight, quality.pixelRatio());
    ctx.sky.setShadowSize(t.shadows);
    ctx.waves.setCount(t.waves); ctx.waves.setSeaState(CONFIG.seaStates[ctx.state.seaState]); ctx.ocean.setResolution(t); ctx.ocean.syncWaves();
  };
  quality.addEventListener('change', applyTier);
  quality.addEventListener('resize', () => { renderer.setPixelRatio(quality.pixelRatio()); ctx.post.setSize(innerWidth, innerHeight, quality.pixelRatio()); });
  applyTier();
  ctx.setSeaState(ctx.state.seaState);
  ctx.setTimeOfDay(ctx.state.timeOfDay);
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight); ctx.post.setSize(innerWidth, innerHeight, quality.pixelRatio());
    ctx.fieldmap.resize();
  });

  // shore scene switching
  ctx.shore = new Shore(ctx);
  ctx.activeScene = scene;
  ctx.rig.addEventListener('scene', async (e) => {
    const toShore = e.detail === 'shore';
    if (toShore && !ctx.shore.loaded) { ctx.hud.alert({ text: 'Loading the shore terminal…', tone: 'sky' }); await ctx.shore.load(); }
    if (ctx.rig.scene !== e.detail) return;   // the user moved on while it loaded
    const target = toShore ? ctx.shore.scene : scene;
    for (const o of [ctx.sky.group, ctx.ocean.mesh]) target.add(o);
    target.environment = ctx.sky.envRT.texture; target.environmentIntensity = CONFIG.timeOfDay[ctx.state.timeOfDay].env;
    if (ctx.underwater.active) ctx.underwater.setActive(false, scene, ctx.sky, CONFIG.timeOfDay[ctx.state.timeOfDay]);
    target.add(camera);
    ctx.activeScene = target; ctx.post.render.scene = target;
    ctx.ocean.setTrail([]); ctx.ocean.setSpots([]);
    ctx.hud.log(toShore ? '[VIEW] Shore receiving terminal, about 78 km from the field.' : '[VIEW] Back to the Halcyon Shoal field.');
  });

  // first interaction unlocks audio (it stays muted until the sound button is pressed)
  const unlock = () => { ctx.audio.start(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);

  // start rendering, then hide the loader
  progress(0.88, 'Composing the scene…');
  const clock = new THREE.Timer(); clock.connect(document);
  let simT = 0, mapT = 0, wasUnder = false;
  const flareTop = new THREE.Vector3(), v = new THREE.Vector3();

  function frame() {
    clock.update(); const rdt = Math.min(clock.getDelta(), 0.1);
    const dt = rdt * ctx.state.simSpeed;
    simT += dt;
    shared.uTime.value = simT;
    const onField = ctx.activeScene === scene;

    ctx.rig.update(rdt);
    if (ctx.rig.scene === 'shore' && camera.position.y < 4) camera.position.y = 4;
    const surfaceY = ctx.waves.heightAt(camera.position.x, camera.position.z, simT);
    const under = onField && camera.position.y < surfaceY - 0.05;
    if (under !== wasUnder) { ctx.underwater.setActive(under, scene, ctx.sky, CONFIG.timeOfDay[ctx.state.timeOfDay]); }
    const surfaced = wasUnder && !under; wasUnder = under;

    ctx.sky.update(dt, camera, ctx.rig.controls.target);
    ctx.ocean.update(simT, camera);
    // everything below the waterline is hidden while the camera is above it (the sea is opaque from above)
    const subVisible = under || camera.position.y < 4;
    ctx.seabed.group.visible = subVisible;
    for (const w of ctx.field.wellheads) if (w.line) w.line.visible = subVisible;
    if (ctx.field.trunkline) ctx.field.trunkline.visible = subVisible;
    if (onField) {
      ctx.seabed.update(camera);
      ctx.underwater.update(dt, simT, camera, surfaceY);
      ctx.field.update(dt, simT, ctx.wind);
      ctx.vessel.update(dt, simT, ctx.waves);
      ctx.heli.update(dt, simT);
      ctx.marine.update(dt, simT, ctx.waves);
      if (ctx.vessel.state !== 'ALONGSIDE' && ctx.field.crane) ctx.field.setCrane(null, dt);
      ctx.ocean.setSpots([...ctx.field.waterlineSpots(ctx.waves.foam ?? 0.5), ...ctx.vessel.foamSpots(), ...ctx.heli.foamSpots(ctx.waves, simT)]);
      // light reflections on the water at dusk / night
      const lights = [];
      if (ctx.night > 0.1) {
        ctx.field.flare.worldTop(flareTop);
        lights.push({ p: flareTop, c: new THREE.Color(1.0, 0.5, 0.18), i: 3.5 * ctx.night });
        ctx.field.lamps.slice(0, 3).forEach((p) => lights.push({ p, c: new THREE.Color(1.0, 0.85, 0.6), i: 1.2 * ctx.night }));
        if (ctx.vessel.root.visible) lights.push({ p: ctx.vessel.root.position.clone().setY(14), c: new THREE.Color(1, 0.92, 0.8), i: 1.0 * ctx.night });
      }
      ctx.ocean.setLights(lights);
    }
    ctx.telemetry.update(dt);
    ctx.audio.update(rdt);
    ctx.hud.update(rdt, simT);
    mapT += rdt; if (mapT > 0.25) { mapT = 0; ctx.fieldmap.draw(); }

    // heat haze above the flare
    let haze = null;
    if (onField && !under) {
      ctx.field.flare.worldTop(flareTop);
      v.copy(flareTop).project(camera);
      const dist = camera.position.distanceTo(flareTop);
      if (v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 && dist < 1500) {
        const r = (ctx.field.flare.height * 0.5) / dist / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.5;
        haze = new THREE.Vector3(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, r);
      }
    }
    ctx.post.update(rdt, simT, { under, surfaced, haze, night: ctx.night });
    ctx.post.composer.render(rdt);
    quality.sample(rdt * 1000);
    requestAnimationFrame(frame);
  }

  ctx.screenshot = () => {
    ctx.post.composer.render(0);
    renderer.domElement.toBlob((b) => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `halcyon-shoal-${Date.now()}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  };

  requestAnimationFrame(frame);
  setTimeout(() => { progress(1, 'Ready'); document.getElementById('loading').classList.add('done'); ctx.rig.go('overview', 0.01); }, 250);
  ctx.hud.log('[SYS] Halcyon Shoal online. All production figures are simulated.');

  // stage 2: vessel, helicopter, crew, marine life and birds
  await ctx.assets.load(['psv', 'heli', 'crew', 'fish', 'turtle', 'whaleshark', 'whale', 'gull']);
  const [psv, heli, crew] = await Promise.all([ctx.assets.instance('psv'), ctx.assets.instance('heli'), ctx.assets.instance('crew')]);
  ctx.vessel = new Vessel(ctx, psv); scene.add(ctx.vessel.root);
  ctx.heli = new Helicopter(ctx, heli, crew); scene.add(ctx.heli.root);
  const marine = new Marine(ctx); await marine.build(); scene.add(marine.group); ctx.marine = marine;
  ctx.shore.load();   // preload the shore terminal in the background
  let sightT = settings.marine.ambientSightingSeconds;
  setInterval(() => {   // occasional unprompted sightings
    sightT -= 1 * ctx.state.simSpeed;
    if (sightT < 0) { sightT = settings.marine.ambientSightingSeconds * (1.5 + Math.random()); if (Math.random() < 0.6) ctx.marine.spawnWhaleShark(); else ctx.marine.spawnWhale(); }
  }, 1000);
}

boot().catch((e) => { console.error(e); loadText.textContent = 'Something went wrong while loading: ' + e.message; });
