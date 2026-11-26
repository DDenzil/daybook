// Device tier detection and adaptive resolution (plan section 11).
import { CONFIG } from '../config.js';

export class Quality extends EventTarget {
  constructor(renderer) {
    super();
    this.renderer = renderer;
    this.tierName = Quality.detect(renderer);
    const saved = safeGet('hs.tier');
    if (saved && CONFIG.tiers[saved]) this.tierName = saved;
    this.tier = CONFIG.tiers[this.tierName];
    this.scale = this.tier.pixelRatio;      // fraction of device pixel ratio
    this.frameTimes = [];
    this.lowSince = 0;
    this.auto = !saved;
  }

  static detect(renderer) {
    const ua = navigator.userAgent || '';
    const mobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
    if (mobile) return 'phone';
    let gpu = '';
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch (e) { /* ignore */ }
    if (/NVIDIA|GeForce|RTX|GTX|Radeon RX|Radeon Pro|Arc A/i.test(gpu)) return 'plus';
    return 'pc';
  }

  pixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier.maxPixelRatio);
    return Math.max(0.5, dpr * this.scale);
  }

  set(name, persist = true) {
    if (!CONFIG.tiers[name]) return;
    this.tierName = name; this.tier = CONFIG.tiers[name]; this.scale = this.tier.pixelRatio;
    if (persist) { safeSet('hs.tier', name); this.auto = false; }
    this.dispatchEvent(new Event('change'));
  }

  // Called every frame with the real frame time (ms). Steps resolution down, then the tier.
  sample(ms) {
    if (!this.auto) return;
    this.frameTimes.push(ms);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const fps = 1000 / avg;
    const target = this.tier.targetFps;
    if (fps < target * 0.8) {
      if (this.scale > 0.55) { this.scale = Math.max(0.55, this.scale - 0.1); this.dispatchEvent(new Event('resize')); }
      else if (this.tierName === 'plus') this.set('pc', false);
      else if (this.tierName === 'pc') this.set('phone', false);
    } else if (fps > target * 1.15 && this.scale < this.tier.pixelRatio) {
      this.scale = Math.min(this.tier.pixelRatio, this.scale + 0.05); this.dispatchEvent(new Event('resize'));
    }
  }
}

export function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
export function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
