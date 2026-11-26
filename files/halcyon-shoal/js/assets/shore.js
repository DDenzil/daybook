// Shore receiving terminal: a separate scene, loaded only when the Shore Terminal view is chosen.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class Shore {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xc9c2b0, CONFIG.fogAboveDensity * 1.6);
    this.loaded = false;
  }
  async load() {
    if (this.loaded) return;
    const m = await this.ctx.assets.instance('shore');
    this.scene.add(m);
    this.loaded = true;
  }
}
