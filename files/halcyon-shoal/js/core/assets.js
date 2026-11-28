// Model loading: compressed .glb files from /models (built by tools/blender, packed with gltfpack).
// To replace a model, drop a new .glb with the same file name and node names into /models.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { processModel } from './materials.js';

// Models are meshopt-compressed .glb by default. A host that cannot serve .glb or run WebAssembly
// can use base64 text copies of uncompressed .glb files: set <html data-models="txt"> and provide models/<name>.txt.
const MODE = document.documentElement.dataset.models || 'glb';
export const MODEL_LIST = Object.fromEntries(['cpp', 'lq', 'bridge', 'whp', 'psv', 'heli', 'whaleshark', 'whale', 'turtle', 'fish', 'gull', 'crew', 'seabed_props', 'shore', 'dolphin', 'flyingfish', 'gull_perched'].map((n) => [n, `models/${n}.${MODE}`]));

export class Assets {
  constructor(renderer, onProgress) {
    this.manager = new THREE.LoadingManager();
    this.manager.onProgress = (url, loaded, total) => onProgress && onProgress(loaded / total, url);
    this.loader = new GLTFLoader(this.manager);
    if (MODE !== 'glb') {   // decode embedded textures through <img> (allowed by strict hosts) rather than fetch()
      this.loader.register((parser) => { parser.textureLoader = new THREE.TextureLoader(parser.options.manager); return { name: 'hs_img_textures' }; });
    }

    this.cache = {};
    this.renderer = renderer;
    this.onProgress = onProgress;
    this.done = 0; this.total = 0;
  }

  async load(names) {
    if (MODE === 'glb' && !this.meshopt) {
      try {   // imported on demand: the decoder starts WebAssembly as soon as it loads
        const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
        await MeshoptDecoder.ready;
        this.loader.setMeshoptDecoder(MeshoptDecoder); this.meshopt = true;
      } catch (e) { throw new Error('The model decompressor could not start (this host may block WebAssembly). ' + e.message); }
    }
    await Promise.all(names.map((n) => this.get(n)));
  }

  fetchModel(name) {
    const url = MODEL_LIST[name];
    if (MODE === 'glb') return this.loader.loadAsync(url);
    this.total++;
    return fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }).then((b64) => {
      const bin = atob(b64.trim()); const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return new Promise((res, rej) => this.loader.parse(buf.buffer, '', res, rej));
    }).then((g) => { this.done++; this.onProgress && this.onProgress(this.done / Math.max(this.total, 1), url); return g; });
  }

  get(name) {
    if (!this.cache[name]) {
      this.cache[name] = this.fetchModel(name).then((gltf) => {
        processModel(gltf.scene, { caustic: true });
        return gltf;
      }).catch((e) => {
        console.error('[assets] failed to load', name, e);
        throw new Error(`Could not load ${MODEL_LIST[name]}: ${e && e.message ? e.message : e}`);
      });
    }
    return this.cache[name];
  }

  // A fresh instance of a model (shares geometry and materials with the cached original)
  async instance(name) {
    const g = await this.get(name);
    return g.scene.clone(true);
  }
}

export function findNode(root, name) {
  let out = null;
  root.traverse((o) => { if (!out && o.name === name) out = o; });
  return out;
}

// gltfpack stores positions quantized and puts the de-quantization scale in the node transform.
// These helpers bake transforms into plain float geometry when a shader or instancing needs real metres.
export function toFloat(geo) {
  const g = geo.clone();
  for (const name of ['position', 'normal', 'uv', 'uv1']) {
    const a = g.getAttribute(name); if (!a) continue;
    const n = a.itemSize, out = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, n));
  }
  return g;
}

// Geometry of every mesh under root, expressed in root space (float). Returns [{geometry, material, name}]
export function bakedMeshes(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = toFloat(o.geometry);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    g.computeBoundingBox(); g.computeBoundingSphere();
    out.push({ geometry: g, material: o.material, name: o.name });
  });
  return out;
}

// Replace a model's mesh hierarchy with flat meshes in root space (non-mesh nodes are kept).
export function flatten(root) {
  const parts = bakedMeshes(root);
  const meshes = []; root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    [...m.children].forEach((c) => root.attach(c));   // keep child nodes (e.g. the blowhole marker)
    m.parent.remove(m);
  }
  return parts.map((p) => { const m = new THREE.Mesh(p.geometry, p.material); m.name = p.name; m.castShadow = true; root.add(m); return m; });
}
