// Small procedural texture helpers (canvas based, generated once at start-up).
import * as THREE from 'three';

// Tileable value noise
function makeNoise(size, seed) {
  const g = new Float32Array(size * size);
  let s = seed >>> 0;
  for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const ix = ((x0 % size) + size) % size, iy = ((y0 % size) + size) % size;
    const ix1 = (ix + 1) % size, iy1 = (iy + 1) % size;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[iy * size + ix], b = g[iy * size + ix1], c = g[iy1 * size + ix], d = g[iy1 * size + ix1];
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

export function fbm(noise, x, y, oct, base) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += noise(x * f * base / (base), y * f) * amp; amp *= 0.5; f *= 2; }
  return v;
}

// R: grime blotches, G: streaks, B: fine noise. Tileable, 256 px.
export function grimeTexture(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
  const n1 = makeNoise(16, 11), n2 = makeNoise(64, 23), n3 = makeNoise(128, 37);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let r = 0, amp = 0.55, f = 1;
    for (let o = 0; o < 4; o++) { r += n1(u * 16 * f, v * 16 * f) * amp; amp *= 0.5; f *= 2; if (16 * f > 16) break; }
    r = n1(u * 16, v * 16) * 0.6 + n2(u * 64, v * 64) * 0.3 + n3(u * 128, v * 128) * 0.1;
    const streak = n2(u * 64, v * 4) * 0.7 + n3(u * 128, v * 8) * 0.3;
    const fine = n3(u * 128, v * 128);
    const i = (y * size + x) * 4;
    img.data[i] = Math.max(0, Math.min(255, (r - 0.35) * 2.2 * 255));
    img.data[i + 1] = Math.max(0, Math.min(255, (streak - 0.4) * 2.5 * 255));
    img.data[i + 2] = fine * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Tileable normal map for small-scale water detail.
export function waterNormalTexture(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
  const n1 = makeNoise(8, 5), n2 = makeNoise(16, 9), n3 = makeNoise(32, 13);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    h[y * size + x] = n1(u * 8, v * 8) * 0.5 + n2(u * 16, v * 16) * 0.3 + n3(u * 32, v * 32) * 0.2;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = h[y * size + ((x - 1 + size) % size)], xr = h[y * size + ((x + 1) % size)];
    const yd = h[((y - 1 + size) % size) * size + x], yu = h[((y + 1) % size) * size + x];
    let nx = (xl - xr) * 6, ny = (yd - yu) * 6, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Window mask for the accommodation block: 4 bays x 5 floors, some cabins unlit.
// Layout matches tools/blender/kit.py 'window' texture (192 x 256 px per bay).
export function windowMaskTexture() {
  const bw = 48, bh = 64, nx = 4, ny = 5;
  const c = document.createElement('canvas'); c.width = bw * nx; c.height = bh * ny;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  let s = 7;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    s = (s * 16807) % 2147483647;
    const lit = (s % 100) / 100;
    if (lit < 0.28) continue;
    const warm = 180 + (s % 60);
    ctx.fillStyle = `rgb(${warm},${Math.round(warm * 0.85)},${Math.round(warm * 0.6)})`;
    ctx.fillRect(i * bw + 10, j * bh + 17, 28, 26);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.flipY = false; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / nx, 1 / ny);
  return t;
}

// Soft radial sprite (bubbles, particles, glow)
export function softSprite(size = 64, inner = 0.0) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * inner / 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Vertical light-shaft gradient
export function shaftTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
  const h = ctx.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = h; ctx.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
