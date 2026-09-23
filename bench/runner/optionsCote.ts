// What distinguishes one side of the comparison from the other: its engine, compiled cache,
// and diagnostic variant. Separated from `options.ts`, which now only reads campaign settings.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SideBase } from './dists.ts';
import type { ScreenErrorVariant } from '../../packages/sdk-core/src/index.ts';
import type { TextureCompression } from '../../packages/sdk-browser/src/texture/blockFormats.ts';

// Benchmark Chromium flags: unbridled background rendering, enabled GPU benchmarking, WebGPU enabled.
const BASE_FLAGS = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--enable-gpu-benchmarking',
];
const WEBGPU_FLAGS = [...BASE_FLAGS, '--enable-unsafe-webgpu'];

/** One engine the harness knows how to measure: its backend factory, Chromium flags, and page. */
export interface EngineDescriptor {
  backend: string | null;
  id: string;
  flags: string[];
  three?: boolean;
  autonomous?: boolean;
  page: string;
  source: 'cache' | 'gltf';
}

/**
 * A side ready to run: `equipSide` turns a `SideBase` into one of these by filling `engine`,
 * `variant` and `errorMetric`, which every measurement afterward reads as present.
 */
export interface Side extends SideBase {
  engine: EngineDescriptor;
  variant: string | null;
  compression: TextureCompression | null;
  errorMetric: ScreenErrorVariant | null;
}

// Standalone WebGL2 engine is the only one of the three decoding geometry pages itself.
// `three` indicates the engine renders with Three.js.
// `page` is the module served under `/mesure/` whose `measureView` plays the series;
// `source` indicates what the page loads: compiled cache (`cache`) or source glTF from assets (`gltf`).
export const ENGINES: Record<string, EngineDescriptor> = {
  webgl: {
    backend: 'exactPagesBackend',
    id: 'exact-cluster-pages',
    flags: BASE_FLAGS,
    three: true,
    page: 'pageEclairage.ts',
    source: 'cache',
  },
  webgpu: {
    backend: 'webgpuPagesBackend',
    id: 'webgpu-page-raster',
    flags: WEBGPU_FLAGS,
    page: 'pageEclairage.ts',
    source: 'cache',
  },
  // Raw Three.js witness: no SDK, raw glTF rendered by Three alone (`pageThreeNu.ts`).
  'three-nu': {
    backend: null,
    id: 'three-nu',
    flags: BASE_FLAGS,
    page: 'pageThreeNu.ts',
    source: 'gltf',
  },
  // Three.js witness with levels of detail: raw Three plus `THREE.LOD` per mesh (`pageThreeLod.ts`).
  'three-lod': {
    backend: null,
    id: 'three-lod',
    flags: BASE_FLAGS,
    page: 'pageThreeLod.ts',
    source: 'gltf',
  },
  webgl2: {
    backend: 'autonomousPagesBackend',
    id: 'autonomous-pages-webgl',
    flags: BASE_FLAGS,
    autonomous: true,
    three: true,
    page: 'pageEclairage.ts',
    source: 'cache',
  },
};

/** Cache, engine, diagnostic variant, texture compression and error metric for one side. */
export function equipSide(
  side: SideBase,
  flags: Map<string, string>,
  settings: { engine: string },
): Side {
  const equipped = side as Side;
  equipped.cache = resolveCache(flags.get(`cache-${side.name}`));
  equipped.engine = engineOf(flags, side.name, settings.engine);
  equipped.variant = variantOf(flags, side.name);
  // Block format of the texture pools: two sides on one cache and two formats measure the
  // format alone — same poses, same tiles, same server. `null` leaves the engine's choice.
  equipped.compression = sideChoice(flags, side.name, 'compression', [
    'auto',
    'bc7',
    'astc',
    'none',
  ]) as TextureCompression | null;
  // Screen error metric (EXPERIMENT): `certifiee` is our bound, `reference` the standard
  // external projection; `null` leaves ours.
  equipped.errorMetric = sideChoice(flags, side.name, 'erreur', [
    'certifiee',
    'reference',
  ]) as ScreenErrorVariant | null;
  return equipped;
}

/** A side's choice among `allowed`: `--<key>-<side>`, otherwise `--<key>`, otherwise `null`. */
function sideChoice(flags: Map<string, string>, name: string, key: string, allowed: string[]) {
  const value = flags.get(`${key}-${name}`) ?? flags.get(key) ?? null;
  if (value !== null && !allowed.includes(value))
    throw new Error(`--${key}-${name} must be ${allowed.join(', ')}`);
  return value;
}

/** What a side publishes about itself in the report: dist, cache, engine, variant. */
export const sideReport = (side: Side) =>
  [
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
  ] as const;

/** Diagnostic variant of a side: `--variante-<side>`, otherwise campaign variant. */
function variantOf(flags: Map<string, string>, name: string) {
  return flags.get(`variante-${name}`) ?? flags.get('variante') ?? null;
}

/** Engine of a side: `--moteur-<side>` if provided, otherwise campaign engine. */
export function engineOf(flags: Map<string, string>, name: string, fallback: string) {
  const engine = flags.get(`moteur-${name}`) ?? fallback;
  const found = ENGINES[engine];
  if (!found) throw new Error(`--moteur-${name} must be ${Object.keys(ENGINES).join(', ')}`);
  return found;
}

/**
 * Cache of a side. Value names the derived directory containing `native/full` or directly `native/full`.
 */
export function resolveCache(value: string | undefined) {
  if (!value) return undefined;
  const dir = resolve(value);
  for (const candidate of [dir, join(dir, '../..')])
    if (existsSync(join(candidate, 'native/full/manifest.json'))) return resolve(candidate);
  throw new Error(`cache without native/full/manifest.json: ${dir}`);
}
