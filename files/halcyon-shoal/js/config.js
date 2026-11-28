// Halcyon Shoal — central configuration.
// World scale: 1 unit = 1 metre. Sea level is y = 0. +x east, -z north.
// Values here are defaults; data/settings.json overrides the editable ones at start-up.

export const CONFIG = {
  appName: 'Halcyon Shoal',
  waterLevel: 0,
  waterDepth: 45,                 // seabed is at -waterDepth (+ small terrain variation)
  earthRadius: 6371000,
  gravity: 9.81,

  // Fixed facility layout (metres)
  cpp: { x: 0, z: 0 },            // central processing platform
  lq: { x: -92, z: 6 },           // living quarters platform
  bridgeDeckY: 30,

  // Logistics geometry
  heliSpawn: { x: 9500, y: 420, z: -3500 },
  vesselSpawn: { x: 7600, z: 5200 },
  vesselStation: { x: 8, z: 91, heading: Math.PI },  // stern-to on the south face of the CPP, stern about 15 m clear of the jacket

  // Field limits
  minWellheadDistance: 1000,
  maxWellheadDistance: 10000,
  minWellheadSpacing: 800,
  shoreDistanceKm: 78,

  fogAboveDensity: 1.15e-4,       // ~12 km visibility in Gulf haze
  fogBelowDensity: 0.02,          // clear offshore water: structures readable to ~60 m, fading out by ~90 m

  camera: { fov: 50, near: 0.3, far: 160000 },

  timeOfDay: {
    midday:  { elevation: 62, azimuth: 160, turbidity: 3.8, rayleigh: 1.1, mie: 0.005, exposure: 0.2, sun: 5.5, hemi: 0.5, env: 0.6, fog: 0xc9c2b0, lightsOn: false, uwFog: 0x2a7d86 },
    golden:  { elevation: 9,  azimuth: 248, turbidity: 8.0, rayleigh: 2.2, mie: 0.008, exposure: 0.55, sun: 2.4, hemi: 0.25, env: 0.25, fog: 0xd8b48c, lightsOn: false, uwFog: 0x23666f },
    dusk:    { elevation: 1.2, azimuth: 258, turbidity: 9.0, rayleigh: 3.0, mie: 0.01, exposure: 0.95, sun: 0.9, hemi: 0.15, env: 0.22, fog: 0x8a6f68, lightsOn: true, uwFog: 0x123a44 },
    night:   { elevation: -14, azimuth: 270, turbidity: 2.0, rayleigh: 0.6, mie: 0.004, exposure: 1.1, sun: 0.0, hemi: 0.05, env: 0.12, fog: 0x0d131c, lightsOn: true, uwFog: 0x03101a, moon: 0.12 }
  },

  seaStates: {
    calm:     { amp: 0.45, choppy: 0.6, foam: 0.25, wind: 4 },
    moderate: { amp: 1.0,  choppy: 1.0, foam: 0.55, wind: 9 },
    rough:    { amp: 1.9,  choppy: 1.2, foam: 1.0,  wind: 16 }
  },

  // Device tiers (plan section 11)
  tiers: {
    phone: { label: 'Phone', pixelRatio: 0.7, maxPixelRatio: 1.25, shadows: 1024, bloom: false, aa: 'fxaa', waves: 6,  oceanRadial: 96,  oceanNear: 1.0, fish: 150, tex: 512,  seagrass: 600,  haze: false, birds: 6,  targetFps: 30 },
    pc:    { label: 'PC (integrated graphics)', pixelRatio: 0.9, maxPixelRatio: 1.5, shadows: 2048, bloom: true, aa: 'smaa', waves: 8,  oceanRadial: 128, oceanNear: 0.7, fish: 600, tex: 1024, seagrass: 1800, haze: true, birds: 10, targetFps: 60 },
    plus:  { label: 'Plus', pixelRatio: 1.0, maxPixelRatio: 2.0, shadows: 4096, bloom: true, aa: 'smaa', waves: 10, oceanRadial: 160, oceanNear: 0.5, fish: 1500, tex: 1024, seagrass: 4000, haze: true, birds: 14, targetFps: 60 }
  }
};

// Merge data/settings.json into CONFIG; returns the parsed settings (or defaults if unavailable).
export async function loadSettings() {
  const fallback = {
    field: {
      waterDepth: 45,
      wellheads: [
        { code: 'HS-WHP-01', pos: [-3200, -2400], flow: 268, pressure: 141 },
        { code: 'HS-WHP-02', pos: [900, -5200], flow: 291, pressure: 146 },
        { code: 'HS-WHP-03', pos: [4800, -3100], flow: 254, pressure: 138 },
        { code: 'HS-WHP-04', pos: [5600, 2600], flow: 302, pressure: 149 },
        { code: 'HS-WHP-05', pos: [-4100, 3900], flow: 276, pressure: 143 }
      ]
    },
    telemetry: { trunklinePressureBase: 112, trunklinePressurePerWell: 1.3, newWellFlowMin: 240, newWellFlowMax: 325 },
    logistics: { helicopterFirstFlightSeconds: 25, helicopterTurnaroundSeconds: 70, helicopterIdleSeconds: 120, vesselFirstVoyageSeconds: 6, vesselCargoSeconds: 60, vesselIdleSeconds: 140 },
    marine: { ambientSightingSeconds: 45 },
    defaults: { timeOfDay: 'golden', seaState: 'moderate', simSpeed: 1, labels: true, volume: 0.8 }
  };
  let s = fallback;
  try {
    const res = await fetch('data/settings.json', { cache: 'no-cache' });
    if (res.ok) s = deepMerge(fallback, await res.json());
  } catch (e) { console.warn('[settings] using built-in defaults', e); }
  const f = s.field;
  if (f.waterDepth) CONFIG.waterDepth = f.waterDepth;
  for (const k of ['minWellheadDistance', 'maxWellheadDistance', 'minWellheadSpacing', 'shoreDistanceKm']) if (f[k]) CONFIG[k] = f[k];
  return s;
}

function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice();
  if (b && typeof b === 'object') {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = (a && typeof a[k] === 'object' && !Array.isArray(a[k])) ? deepMerge(a[k], b[k]) : b[k];
    return out;
  }
  return b;
}

// Zero-padded wellhead code (plan section 10 fix)
export function wellheadCode(n) { return `HS-WHP-${String(n).padStart(2, '0')}`; }
