// Platform crane cargo operations while the supply vessel is alongside:
//   1. delivery: the container on the vessel's aft deck is lifted to a free laydown slot on HS-CPP;
//   2. backload: a container waiting on the platform is lifted down to the vessel's empty slot.
// Collision rules:
//   - laydown slots come from a ray-scanned height map of the platform (clear of equipment, in reach);
//   - a slot is only used if no container already sits on it;
//   - loads travel at a height that clears the tallest structure (and any container) under the whole
//     swing path, and are only lowered once the hook is over the destination;
//   - a live guard keeps the load's underside above whatever is directly below it at every frame.
import * as THREE from 'three';
import { topUnder, LAYDOWN_SLOTS, DECKMAP } from '../assets/cppmap.js';

const HOOK = 6.6;             // hook height above the container's base (rigging + container)
const BOX_H = 2.6, HX = 1.25, HZ = 3.05;
const V_SPD = 2.2, H_SPD = 3.0;
const tmp = new THREE.Vector3();

export class CraneOps {
  constructor(ctx, vessel) {
    this.ctx = ctx; this.vessel = vessel;
    this.slots = LAYDOWN_SLOTS.map(([x, z]) => ({ x, z, y: topUnder(x, z, HX, HZ), item: null }));
    this.tgt = null; this.steps = []; this.done = true;
    // a container already on the platform waiting to be shipped back ashore
    if (vessel.cargo) {
      const c = vessel.cargo.clone(true);
      c.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(0x6f7f88); } });
      const s = this.slots[Math.min(3, this.slots.length - 1)];
      this.place(c, s); ctx.scene.add(c);
    }
  }

  place(obj, slot) {
    obj.position.set(slot.x, slot.y, slot.z); obj.rotation.set(0, Math.PI, 0);
    slot.item = obj; obj.userData.landedAt = performance.now();
  }

  // highest thing under a container footprint at (x, z): platform structure or another container
  topAt(x, z, ignore) {
    let top = topUnder(x, z, HX + 0.3, HZ + 0.3);
    for (const s of this.slots) if (s.item && s.item !== ignore && Math.abs(s.x - x) < 2 * HX + 0.3 && Math.abs(s.z - z) < 2 * HZ + 0.3) top = Math.max(top, s.y + BOX_H);
    return top;
  }
  // travel height (container base) clearing everything along a to b
  clearY(a, b, ignore) {
    let top = 0;
    const n = Math.ceil(a.distanceTo(b) / 1.5) + 1;
    for (let i = 0; i <= n; i++) { const k = i / n; top = Math.max(top, this.topAt(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, ignore)); }
    return top + 2.5;
  }

  vesselSlot(out) { const v = this.vessel; out.copy(v.cargoHome); v.cargoParent.localToWorld(out); return out; }

  start() {
    const field = this.ctx.field, v = this.vessel;
    this.done = !field.crane || !v.cargo;
    if (this.done) return;
    this.load = null; this.tgt = new THREE.Vector3(); field.hookWorld(this.tgt);
    const free = this.slots.filter((s) => !s.item);
    const drop = free.sort((a, b) => Math.hypot(a.x - 3.6, a.z - 57) - Math.hypot(b.x - 3.6, b.z - 57))[0];
    const delivery = v.cargo;
    // the oldest container on the platform goes back ashore
    const back = this.slots.filter((s) => s.item).sort((a, b) => a.item.userData.landedAt - b.item.userData.landedAt)[0];
    const vs = () => this.vesselSlot(new THREE.Vector3());
    const S = [];
    if (drop) {
      S.push({ log: '[CRANE] Delivery lift: container from MV Halcyon Star to the HS-CPP laydown area.' });
      this.liftSteps(S, vs, drop, delivery, 'deliver');
    } else this.ctx.events.emit('log', '[CRANE] No clear laydown slot on HS-CPP. Delivery held on the vessel.');
    if (back) {
      S.push({ log: '[CRANE] Backload lift: container from HS-CPP to MV Halcyon Star.' });
      this.liftSteps(S, () => new THREE.Vector3(back.x, back.y, back.z), null, back.item, 'backload', back);
    }
    S.push({ goal: () => this.parkPos(), wait: 1 });
    this.steps = S; this.i = 0; this.t = 0;
  }

  parkPos() { return new THREE.Vector3(12, 60, 14); }

  // pick at from() (base of the load), lift, swing clear, set down at slot (or the vessel)
  liftSteps(S, from, slot, obj, kind, fromSlot) {
    const dest = () => slot ? new THREE.Vector3(slot.x, slot.y, slot.z) : this.vesselSlot(new THREE.Vector3());
    let travel = 0;
    const plan = () => { travel = Math.max(this.clearY(from(), dest(), obj), from().y + 4, dest().y + 4); };
    S.push({ run: plan });
    S.push({ goal: () => from().add(new THREE.Vector3(0, HOOK + Math.max(8, travel - from().y), 0)) });
    S.push({ goal: () => from().add(new THREE.Vector3(0, HOOK, 0)), track: true, wait: 2.5 });          // sling the load
    S.push({ run: () => { this.attach(obj, fromSlot); this.ctx.events.emit('sound', { id: 'crane_winch', at: from(), key: 'winch', loop: true }); } });
    S.push({ goal: () => { const p = from(); p.y = travel + HOOK; return p; }, loaded: true });                                       // hoist clear
    S.push({ goal: () => { const p = dest(); p.y = travel + HOOK; return p; }, loaded: true, swing: true });                          // swing
    S.push({ goal: () => dest().add(new THREE.Vector3(0, HOOK, 0)), loaded: true, track: true, settle: true });                      // lower
    S.push({ run: () => this.land(obj, slot, kind), wait: 2 });
    S.push({ goal: () => dest().add(new THREE.Vector3(0, HOOK + 8, 0)) });                                                           // unhook, raise
  }

  attach(obj, fromSlot) {
    this.load = obj;
    if (fromSlot) fromSlot.item = null;
    this.ctx.scene.attach(obj);
  }

  land(obj, slot, kind) {
    const v = this.vessel;
    this.load = null;
    this.ctx.events.emit('sound', { stop: 'winch' });
    if (slot) {
      this.place(obj, slot);
      this.ctx.events.emit('sound', { id: 'cargo_set_down', at: obj.position.clone() });
      this.ctx.events.emit('log', '[OSV] Container landed on the HS-CPP laydown area.');
    } else {
      v.cargoParent.attach(obj); obj.position.copy(v.cargoHome); obj.rotation.set(0, 0, 0);
      v.cargo = obj;
      this.ctx.events.emit('sound', { id: 'cargo_set_down', at: this.vesselSlot(new THREE.Vector3()) });
      this.ctx.events.emit('log', '[OSV] Backload container secured on the aft deck of MV Halcyon Star.');
    }
  }

  update(dt) {
    if (this.done) return;
    const field = this.ctx.field;
    const st = this.steps[this.i];
    if (!st) { this.done = true; field.setCrane(null, dt); return; }
    if (!st.started) {
      st.started = true; this.t = 0;
      if (st.log) this.ctx.events.emit('log', st.log);
      if (st.run) st.run();
    }
    this.t += dt;
    let reached = true;
    if (st.goal) {
      const g = st.goal();
      if (st.track && !st.swing) {
        // when over the target, follow it exactly (the vessel deck moves with the waves)
        const near = Math.hypot(g.x - this.tgt.x, g.z - this.tgt.z) < 1;
        if (near) { this.tgt.x = g.x; this.tgt.z = g.z; }
      }
      const dx = g.x - this.tgt.x, dz = g.z - this.tgt.z, dh = Math.hypot(dx, dz);
      const mh = H_SPD * dt;
      if (dh > mh) { this.tgt.x += dx / dh * mh; this.tgt.z += dz / dh * mh; } else { this.tgt.x = g.x; this.tgt.z = g.z; }
      if (st.track && Math.abs(g.y - this.tgt.y) < 0.6 && dh < 0.6) this.tgt.y = g.y;
      const dy = g.y - this.tgt.y, mv = V_SPD * dt * (st.settle && Math.abs(dy) < 1.5 ? 0.35 : 1);
      // don't start lowering until the hook is over the destination
      const overDest = dh < 0.6;
      if (dy > 0 || overDest || !st.loaded) this.tgt.y += THREE.MathUtils.clamp(dy, -mv, mv);
      field.hookWorld(tmp);
      reached = (dh < 0.05 && Math.abs(g.y - this.tgt.y) < 0.03 && tmp.distanceTo(this.tgt) < (st.track ? 0.7 : 0.8)) || this.t > 60;
    }
    // live guard: the load's underside never goes below whatever is under it
    if (this.load) {
      field.hookWorld(tmp);
      const under = this.topAt(tmp.x, tmp.z, this.load);
      if (under > -50 && this.tgt.y - HOOK < under && !(st.settle && this.isDest(tmp))) this.tgt.y = under + HOOK;
    }
    field.setCrane(this.tgt, dt);
    if (this.load) {
      field.hookWorld(tmp);
      this.load.position.copy(tmp).add(new THREE.Vector3(0, -HOOK, 0));
      this.load.rotation.set(0, this.vessel.heading + Math.sin(this.t * 0.4) * 0.04, 0);
    }
    if (reached && this.t >= (st.wait || 0)) { (this.trace ||= []).push([this.i, +this.t.toFixed(1)]); this.i++; }
  }

  // the set-down point itself is allowed (its own surface is the floor)
  isDest(p) { return true; }
}

export { DECKMAP };
