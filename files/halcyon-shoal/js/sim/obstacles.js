// Obstacle avoidance for large animals and the supply vessel.
// Static obstacles are boxes around the jackets and wellhead platforms (plus a no-go zone for the
// vessel under the CPP–LQ bridge). Dynamic obstacles are spheres reported by moving things
// (the vessel hull, whale, whale shark, dolphins). Agents steer with look-ahead and are pushed out
// of anything they still overlap.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const q = new THREE.Vector3(), out = new THREE.Vector3();
export const headingOf = (dx, dz) => Math.atan2(-dx, -dz);

export class Obstacles {
  constructor(ctx) { this.ctx = ctx; this.boxes = []; this.providers = []; this.rebuild(); }

  rebuild() {
    const b = [];
    b.push({ name: 'HS-CPP', x0: -25, x1: 25, z0: -35, z1: 35 });
    b.push({ name: 'HS-LQ', x0: CONFIG.lq.x - 17, x1: CONFIG.lq.x + 17, z0: CONFIG.lq.z - 15, z1: CONFIG.lq.z + 15 });
    for (const w of this.ctx.field.wellheads) b.push({ name: w.code, x0: w.x - 12, x1: w.x + 12, z0: w.z - 12, z1: w.z + 12 });
    b.push({ name: 'bridge', x0: -80, x1: -20, z0: -15, z1: 25, vesselOnly: true });
    this.boxes = b;
  }

  addDynamic(fn) { this.providers.push(fn); }
  spheres() { const s = []; for (const f of this.providers) for (const o of f()) s.push(o); return s; }

  // Steering vector (horizontal) for something at p heading along dir (unit, horizontal) with radius r.
  steer(p, dir, r, opt = {}) {
    out.set(0, 0, 0);
    const look = opt.look ?? 30, margin = opt.margin ?? 12;
    const spheres = this._spheres || this.spheres();
    for (let k = 0; k < 3; k++) {
      const w = [1, 0.8, 0.6][k];
      q.copy(p).addScaledVector(dir, look * k * 0.5);
      for (const b of this.boxes) {
        if (b.vesselOnly && !opt.vessel) continue;
        const cx = THREE.MathUtils.clamp(q.x, b.x0, b.x1), cz = THREE.MathUtils.clamp(q.z, b.z0, b.z1);
        let dx = q.x - cx, dz = q.z - cz, d = Math.hypot(dx, dz);
        if (d === 0) { dx = q.x - (b.x0 + b.x1) / 2; dz = q.z - (b.z0 + b.z1) / 2; d = Math.hypot(dx, dz) || 1; this._push(dx / d, dz / d, 2 * w, dir, k); continue; }
        const reach = r + margin;
        if (d < reach) this._push(dx / d, dz / d, (1 - d / reach) ** 2 * w * 1.5, dir, k);
      }
      for (const s of spheres) {
        if (s.owner && s.owner === opt.self) continue;
        if (opt.ignore && opt.ignore.includes(s.owner)) continue;
        const dx = q.x - s.x, dy = q.y - s.y, dz = q.z - s.z;
        const reach = r + s.r + margin * 0.5;
        if (Math.abs(dy) > r + s.r) continue;
        const d = Math.hypot(dx, dz);
        if (d < reach && d > 1e-3) this._push(dx / d, dz / d, (1 - d / reach) ** 2 * w * 1.5, dir, k);
      }
    }
    return out;
  }

  _push(nx, nz, s, dir, k) {
    out.x += nx * s; out.z += nz * s;
    if (k > 0) {     // slide round the obstacle instead of stopping in front of it
      let tx = -nz, tz = nx;
      if (tx * dir.x + tz * dir.z < 0) { tx = -tx; tz = -tz; }
      out.x += tx * s * 1.3; out.z += tz * s * 1.3;
    }
  }

  // Hard constraint: push p (horizontally) out of any obstacle it overlaps.
  resolve(p, r, opt = {}) {
    for (const b of this.boxes) {
      if (b.vesselOnly && !opt.vessel) continue;
      const x0 = b.x0 - r, x1 = b.x1 + r, z0 = b.z0 - r, z1 = b.z1 + r;
      if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1) {
        const m = [p.x - x0, x1 - p.x, p.z - z0, z1 - p.z], i = m.indexOf(Math.min(...m));
        if (i === 0) p.x = x0; else if (i === 1) p.x = x1; else if (i === 2) p.z = z0; else p.z = z1;
      }
    }
    for (const s of this._spheres || this.spheres()) {
      if (s.owner && s.owner === opt.self) continue;
      if (opt.ignore && opt.ignore.includes(s.owner)) continue;
      const dx = p.x - s.x, dz = p.z - s.z, dy = p.y - s.y, rr = r + s.r;
      if (Math.abs(dy) > rr) continue;
      const d = Math.hypot(dx, dz);
      if (d < rr && d > 1e-3) { p.x = s.x + dx / d * rr; p.z = s.z + dz / d * rr; }
    }
    return p;
  }

  // collect the dynamic spheres once per frame
  beginFrame() { this._spheres = null; this._spheres = this.spheres(); }
}

// Follows a path by chasing a point a little ahead of it, steering round obstacles on the way.
// If it falls behind (after a detour) the point waits for it.
export class PathAgent {
  constructor(obs, path, o = {}) {
    this.obs = obs; this.setPath(path);
    this.r = o.radius ?? 3; this.lead = o.lead ?? 20; this.turn = o.turn ?? 0.6; this.opt = o.opt || {};
    this.pace = 1; this.done = false;
  }
  setPath(path, from) {
    this.path = path; this.len = path.getLength(); this.s = 0; this.done = false;
    this.pos = from ? from.clone() : path.getPointAt(0);
    const t = path.getTangentAt(0); this.dir = new THREE.Vector3(t.x, 0, t.z).normalize();
  }
  get heading() { return headingOf(this.dir.x, this.dir.z); }
  // steer toward a point (round obstacles), at most `turn` rad/s
  seek(dt, speed, carrot, yFollow = true, opt = this.opt) {
    const want = new THREE.Vector3(carrot.x - this.pos.x, 0, carrot.z - this.pos.z);
    const dist = want.length(); if (dist > 1e-3) want.divideScalar(dist);
    const avoid = this.obs.steer(this.pos, this.dir, this.r, opt);
    want.addScaledVector(avoid, 2.2);
    if (want.lengthSq() > 1e-6) {
      want.normalize();
      let a = Math.atan2(this.dir.x * want.z - this.dir.z * want.x, this.dir.x * want.x + this.dir.z * want.z);
      const maxT = this.turn * dt * (1 + Math.min(2, avoid.length()));
      a = THREE.MathUtils.clamp(a, -maxT, maxT);
      const c = Math.cos(a), s = Math.sin(a);
      this.dir.set(this.dir.x * c - this.dir.z * s, 0, this.dir.x * s + this.dir.z * c).normalize();
    }
    this.pos.addScaledVector(this.dir, speed * dt);
    if (yFollow) this.pos.y += (carrot.y - this.pos.y) * Math.min(1, dt * 0.8);
    this.obs.resolve(this.pos, this.r, opt);
    return this;
  }
  update(dt, speed, yFollow = true) {
    this.s = Math.min(this.len, this.s + speed * dt * this.pace);
    const carrot = this.path.getPointAt(Math.min(1, (this.s + this.lead) / this.len));
    this.seek(dt, speed, carrot, yFollow);
    const onPath = this.path.getPointAt(this.s / this.len);
    const lag = Math.hypot(onPath.x - this.pos.x, onPath.z - this.pos.z);
    this.pace = lag > this.lead * 1.5 ? THREE.MathUtils.clamp(this.lead * 1.5 / lag, 0.15, 1) : 1;
    const end = this.path.getPointAt(1);
    this.remaining = this.len - this.s + Math.hypot(end.x - this.pos.x, end.z - this.pos.z) * (this.s >= this.len ? 1 : 0);
    if (this.s >= this.len && Math.hypot(end.x - this.pos.x, end.z - this.pos.z) < Math.max(6, this.lead * 0.6)) this.done = true;
    return this;
  }
}
