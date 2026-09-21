// What distinguishes one side of the comparison from the other: its engine, compiled cache,
// and diagnostic variant. Separated from `options.mjs`, which now only reads campaign settings.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Benchmark Chromium flags: unbridled background rendering, enabled GPU benchmarking, WebGPU enabled.
const BASE_FLAGS = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--enable-gpu-benchmarking',
];
const WEBGPU_FLAGS = [...BASE_FLAGS, '--enable-unsafe-webgpu'];

// Standalone WebGL2 engine is the only one of the three decoding geometry pages itself.
// `three` indicates the engine renders with Three.js.
// `page` is the module served under `/mesure/` whose `measureView` plays the series;
// `source` indicates what the page loads: compiled cache (`cache`) or source glTF from assets (`gltf`).
export const ENGINES = {
  webgl: {
    backend: 'exactPagesBackend',
    id: 'exact-cluster-pages',
    flags: BASE_FLAGS,
    three: true,
    page: 'pageEclairage.mjs',
    source: 'cache',
  },
  webgpu: {
    backend: 'webgpuPagesBackend',
    id: 'webgpu-page-raster',
    flags: WEBGPU_FLAGS,
    page: 'pageEclairage.mjs',
    source: 'cache',
  },
  // Raw Three.js witness: no SDK, raw glTF rendered by Three alone (`pageThreeNu.mjs`).
  'three-nu': {
    backend: null,
    id: 'three-nu',
    flags: BASE_FLAGS,
    page: 'pageThreeNu.mjs',
    source: 'gltf',
  },
  // Three.js witness with levels of detail: raw Three plus `THREE.LOD` per mesh (`pageThreeLod.mjs`).
  'three-lod': {
    backend: null,
    id: 'three-lod',
    flags: BASE_FLAGS,
    page: 'pageThreeLod.mjs',
    source: 'gltf',
  },
  webgl2: {
    backend: 'autonomousPagesBackend',
    id: 'autonomous-pages-webgl',
    flags: BASE_FLAGS,
    autonomous: true,
    three: true,
    page: 'pageEclairage.mjs',
    source: 'cache',
  },
};

/** Cache, engine, diagnostic variant, texture compression and error metric for one side. */
export function equipSide(side, flags, settings) {
  side.cache = resolveCache(flags.get(`cache-${side.name}`));
  side.engine = engineOf(flags, side.name, settings.engine);
  side.variant = variantOf(flags, side.name);
  // Block format of the texture pools: two sides on one cache and two formats measure the
  // format alone — same poses, same tiles, same server. `null` leaves the engine's choice.
  side.compression = sideChoice(flags, side.name, 'compression', ['auto', 'bc7', 'astc', 'none']);
  // Screen error metric (EXPERIMENT): `certifiee` is our bound, `reference` the standard
  // external projection; `null` leaves ours.
  side.errorMetric = sideChoice(flags, side.name, 'erreur', ['certifiee', 'reference']);
}

/** A side's choice among `allowed`: `--<key>-<side>`, otherwise `--<key>`, otherwise `null`. */
function sideChoice(flags, name, key, allowed) {
  const value = flags.get(`${key}-${name}`) ?? flags.get(key) ?? null;
  if (value !== null && !allowed.includes(value))
    throw new Error(`--${key}-${name} must be ${allowed.join(', ')}`);
  return value;
}

/** What a side publishes about itself in the report: dist, cache, engine, variant. */
export const sideReport = (side) => [
  side.name,
  {
    dist: side.dist,
    from: side.from,
    cache: side.cache ?? null,
    moteur: side.engine.id,
    variante: side.variant,
    compression: side.compression,
    erreur: side.errorMetric ?? 'certifiee',
  },
];

/** Diagnostic variant of a side: `--variante-<side>`, otherwise campaign variant. */
function variantOf(flags, name) {
  return flags.get(`variante-${name}`) ?? flags.get('variante') ?? null;
}

/** Engine of a side: `--moteur-<side>` if provided, otherwise campaign engine. */
export function engineOf(flags, name, fallback) {
  const engine = flags.get(`moteur-${name}`) ?? fallback;
  if (!ENGINES[engine])
    throw new Error(`--moteur-${name} must be ${Object.keys(ENGINES).join(', ')}`);
  return ENGINES[engine];
}

/**
 * Cache of a side. Value names the derived directory containing `native/full` or directly `native/full`.
 */
export function resolveCache(value) {
  if (!value) return undefined;
  const dir = resolve(value);
  for (const candidate of [dir, join(dir, '../..')])
    if (existsSync(join(candidate, 'native/full/manifest.json'))) return resolve(candidate);
  throw new Error(`cache without native/full/manifest.json: ${dir}`);
}
