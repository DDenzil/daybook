// Simulated production telemetry (clearly labelled as simulated in the HUD).
export class Telemetry {
  constructor(ctx) { this.ctx = ctx; this.t = 0; this.jitter = 0; }
  exportRate() {
    const ws = this.ctx.field.wellheads;
    return ws.reduce((a, w) => a + w.flow, 0) * (1 + this.jitter);
  }
  pressure() {
    const s = this.ctx.settings.telemetry;
    return s.trunklinePressureBase + this.ctx.field.wellheads.length * s.trunklinePressurePerWell + this.jitter * 40;
  }
  update(dt) {
    this.t += dt;
    this.jitter = Math.sin(this.t * 0.11) * 0.004 + Math.sin(this.t * 0.37) * 0.002;
  }
}
