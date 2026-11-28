// Top-down field map at true scale: wellheads (drag to move, tap to add), flowlines, trunkline,
// vessel, helicopter, sightings and the camera's view.
import { CONFIG } from '../config.js';

export class FieldMap {
  constructor(ctx) {
    this.ctx = ctx;
    this.canvas = document.getElementById('fieldmap');
    this.g = this.canvas.getContext('2d');
    this.ranges = [1500, 3000, 6000, 11000];
    this.ri = 2;
    this.drag = null; this.hover = null;
    document.getElementById('map-in').addEventListener('click', () => { this.ri = Math.max(0, this.ri - 1); this.draw(); });
    document.getElementById('map-out').addEventListener('click', () => { this.ri = Math.min(this.ranges.length - 1, this.ri + 1); this.draw(); });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('dblclick', (e) => { const w = this.pick(e); if (w) { this.ctx.hud.select(w); this.ctx.rig.go('wellhead'); } });
    this.resize();
  }

  get range() { return this.ranges[this.ri]; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = Math.max(120, Math.round(r.width || 260));
    this.canvas.width = s * dpr; this.canvas.height = s * dpr; this.dpr = dpr; this.size = s;
    this.draw();
  }

  toScreen(x, z) { const s = this.size / 2; return [s + x / this.range * s, s + z / this.range * s]; }
  toWorld(px, py) { const s = this.size / 2; return [(px - s) / s * this.range, (py - s) / s * this.range]; }
  local(e) { const r = this.canvas.getBoundingClientRect(); return [(e.clientX - r.left) * this.size / r.width, (e.clientY - r.top) * this.size / r.height]; }

  pick(e) {
    const [px, py] = this.local(e);
    let best = null, bd = 16;
    for (const w of this.ctx.field.wellheads) {
      const [sx, sy] = this.toScreen(w.x, w.z);
      const d = Math.hypot(sx - px, sy - py);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  constrain(w, x, z) {
    const d = Math.hypot(x, z);
    const min = CONFIG.minWellheadDistance, max = CONFIG.maxWellheadDistance;
    if (d < min) { x *= min / d; z *= min / d; }
    if (d > max) { x *= max / d; z *= max / d; }
    for (const o of this.ctx.field.wellheads) {
      if (o === w) continue;
      const dd = Math.hypot(x - o.x, z - o.z);
      if (dd < CONFIG.minWellheadSpacing) { const k = CONFIG.minWellheadSpacing / Math.max(dd, 1); x = o.x + (x - o.x) * k; z = o.z + (z - o.z) * k; }
    }
    return [Math.round(x), Math.round(z)];
  }

  down(e) {
    const c = this.ctx;
    if (c.state.addMode) {
      const [px, py] = this.local(e);
      const [x, z] = this.constrain(null, ...this.toWorld(px, py));
      c.field.addWellhead(x, z);
      c.hud.setAddMode(false);
      this.draw(); return;
    }
    const w = this.pick(e);
    if (w) { c.hud.select(w); this.drag = { w, moved: false }; this.canvas.setPointerCapture(e.pointerId); e.preventDefault(); }
  }
  move(e) {
    if (!this.drag) return;
    const [px, py] = this.local(e);
    const [x, z] = this.constrain(this.drag.w, ...this.toWorld(px, py));
    this.drag.moved = true;
    this.ctx.field.moveWellhead(this.drag.w, x, z, false);
    this.draw();
  }
  up() {
    if (!this.drag) return;
    const { w, moved } = this.drag; this.drag = null;
    if (moved) this.ctx.field.moveWellhead(w, w.x, w.z, true);
    this.draw();
  }

  draw() {
    const g = this.g, S = this.size, c = this.ctx;
    if (!S) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const grd = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.7);
    grd.addColorStop(0, '#16465a'); grd.addColorStop(1, '#0b2533');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    // range rings
    g.strokeStyle = 'rgba(160,210,230,0.16)'; g.fillStyle = 'rgba(160,210,230,0.55)'; g.font = '10px system-ui, sans-serif'; g.lineWidth = 1;
    const step = this.range <= 1500 ? 500 : this.range <= 3000 ? 1000 : 2000;
    for (let r = step; r <= this.range * 1.42; r += step) {
      g.beginPath(); g.arc(S / 2, S / 2, r / this.range * S / 2, 0, Math.PI * 2); g.stroke();
      if (r <= this.range) g.fillText(`${r / 1000} km`, S / 2 + 3, S / 2 - r / this.range * S / 2 + 11);
    }
    // north arrow
    g.fillStyle = 'rgba(230,240,245,0.8)'; g.beginPath(); g.moveTo(S - 16, 10); g.lineTo(S - 21, 22); g.lineTo(S - 11, 22); g.fill(); g.fillText('N', S - 19, 33);
    // trunkline to shore
    const [tx, ty] = this.toScreen(0, -9);
    g.strokeStyle = 'rgba(240,178,58,0.75)'; g.lineWidth = 2.2; g.setLineDash([]);
    g.beginPath(); g.moveTo(tx, ty); g.lineTo(S - 4, ty + 2); g.stroke();
    g.fillStyle = 'rgba(240,178,58,0.9)'; g.fillText(`Shore ${CONFIG.shoreDistanceKm} km →`, S - 82, ty - 6);
    // flowlines
    g.strokeStyle = 'rgba(200,220,230,0.45)'; g.lineWidth = 1.4; g.setLineDash([4, 3]);
    for (const w of c.field.wellheads) { const [a, b] = this.toScreen(w.x, w.z); g.beginPath(); g.moveTo(a, b); g.lineTo(...this.toScreen(0, 0)); g.stroke(); }
    g.setLineDash([]);
    // camera view wedge
    const cam = c.camera, cp = cam.position;
    if (c.rig.scene === 'field') {
      const [cx, cy] = this.toScreen(cp.x, cp.z);
      const dir = c.rig.controls.target.clone().sub(cp); const a = Math.atan2(dir.z, dir.x);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 26, a - 0.45, a + 0.45); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();
    }
    // hub
    const [hx, hy] = this.toScreen(0, 0), [lx, ly] = this.toScreen(CONFIG.lq.x, CONFIG.lq.z);
    g.fillStyle = '#f0b23a'; g.fillRect(hx - 4, hy - 4, 8, 8); g.fillRect(lx - 3, ly - 3, 6, 6);
    if (this.range <= 3000) { g.fillStyle = '#ffe1a6'; g.fillText('HS-CPP', hx + 7, hy + 4); }
    // wellheads
    for (const w of c.field.wellheads) {
      const [x, y] = this.toScreen(w.x, w.z);
      const sel = c.state.selected === w;
      g.fillStyle = sel ? '#ffd27a' : '#e6eef3'; g.strokeStyle = sel ? '#f0b23a' : 'rgba(0,0,0,0.4)'; g.lineWidth = sel ? 2 : 1;
      g.beginPath(); g.arc(x, y, sel ? 6 : 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = sel ? '#ffe1a6' : 'rgba(230,238,243,0.85)'; g.fillText(w.code.replace('HS-', ''), x + 7, y + 3);
    }
    // vessel & helicopter
    const v = c.vessel; if (v.root.visible) this.arrow(...this.toScreen(v.pos.x, v.pos.z), v.heading, '#5cc6d8', 6);
    const h = c.heli; if (h.root.visible) this.arrow(...this.toScreen(h.pos.x, h.pos.z), h.yaw, '#ff9d5c', 5);
    for (const [k, col] of [['whaleshark', '#7fe0c8'], ['whale', '#a4a4ff'], ['bluewhale', '#6f8cff'], ['hammerheads', '#d0d6da'], ['dolphins', '#8fd0ff']]) {
      if (!c.marine.sightings[k]) continue;
      const o = c.marine.target(k).position; const [x, y] = this.toScreen(o.x, o.z);
      g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();
    }
    if (c.state.addMode) { g.fillStyle = 'rgba(96,210,140,0.9)'; g.fillText('Tap to place a wellhead', 8, S - 10); }
  }

  arrow(x, y, heading, col, s) {
    const g = this.g;
    const fx = -Math.sin(heading), fz = -Math.cos(heading);
    g.fillStyle = col; g.beginPath();
    g.moveTo(x + fx * s * 1.6, y + fz * s * 1.6);
    g.lineTo(x - fx * s + fz * s * 0.8, y - fz * s - fx * s * 0.8);
    g.lineTo(x - fx * s - fz * s * 0.8, y - fz * s + fx * s * 0.8);
    g.closePath(); g.fill();
  }
}
