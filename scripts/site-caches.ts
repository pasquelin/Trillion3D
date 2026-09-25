/** The scene caches git never tracks (#683), compiled from their committed sources by this
 *  checkout's native compiler, on demand (`pnpm run compile:caches`) and before their readers. */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { firstNewer } from '../packages/sdk-node/src/compiler/freshness.mts';
import { modelScenes } from './docs/examples/models.ts';
import {
  compileFullCache,
  type FullCompile,
  nativeCompiler,
  requireNativeCompiler,
  TRIANGLE_BUDGET,
} from './native-compiler.ts';

const ROOT = resolve(import.meta.dirname, '..');

/** A scene folder, relative to the root, holding `source` and the `cache` compiled from it. */
export interface CookedScene extends Pick<
  FullCompile,
  'source' | 'cache' | 'simplification' | 'stdio'
> {
  directory: string;
}

/** The folder of `scene`'s cache, relative to its directory: `cache` unless it names another. */
export const cacheOf = ({ cache = 'cache' }: CookedScene) => cache;

const example = (name: string): CookedScene => ({
  directory: `site/assets/examples/${name}`,
  source: 'source',
  simplification: 'qem-endpoints',
  stdio: ['ignore', 'ignore', 'inherit'],
});

/** Every cooked scene: the examples (the hall's source is committed as is, written by no
 *  script), the terrain tiles' exact cook beside their simplified one (#414), the gallery's and
 *  the two scenes only the tests read. */
export const COOKED_SCENES: Record<string, CookedScene> = {
  ...Object.fromEntries([...Object.keys(modelScenes), 'hall'].map((name) => [name, example(name)])),
  'terrain-tiles-none': {
    ...example('terrain-tiles'),
    cache: 'cache-none',
    simplification: 'none',
  },
  observatory: {
    directory: 'site/assets/gallery/signature-architecture',
    source: 'source/geometry.gltf',
    simplification: 'qem-endpoints',
  },
  'mountain-terrain': {
    directory: 'tests/fixtures/scenes/mountain-terrain',
    source: 'source/geometry.gltf',
    simplification: 'qem-endpoints',
  },
  'kinetic-garden': {
    directory: 'tests/fixtures/scenes/kinetic-garden',
    source: 'source/garden.gltf',
  },
};

/** The source folder of `scene`, absolute. */
export const sourceOf = ({ directory }: CookedScene, root = ROOT) =>
  resolve(root, directory, 'source');

/** Written beside a compiled cache: the options it was compiled with and the source files it
 *  read, so a file removed or renamed since, which no timestamp shows, makes it stale. */
const stampPath = (scene: CookedScene, root = ROOT) =>
  resolve(root, scene.directory, cacheOf(scene), 'compiled-with.json');
const stampOf = (scene: CookedScene, root = ROOT) => {
  const { source, simplification = 'none' } = scene;
  const files = readdirSync(sourceOf(scene, root), { recursive: true }).map(String).sort();
  return JSON.stringify({ source, simplification, budget: TRIANGLE_BUDGET, files });
};

/** When the compiler was built, or null when there is none to compare with; a compiler older than
 *  its sources makes every cache stale, so the run refuses it instead of keeping its output. */
function compilerTime(): number | null {
  try {
    return statSync(nativeCompiler()).mtimeMs;
  } catch (error) {
    return String(error).includes('COMPILER_STALE') ? Infinity : null;
  }
}

/** Compiles the cache of `scene` again, from nothing, and stamps it. */
export function compileCache(scene: CookedScene): void {
  const { directory, ...compile } = scene;
  const cwd = resolve(ROOT, directory),
    cache = cacheOf(scene);
  rmSync(resolve(cwd, cache), { recursive: true, force: true });
  compileFullCache({ cwd, ...compile, cache });
  rmSync(resolve(cwd, cache, 'native/.lock'), { force: true });
  writeFileSync(stampPath(scene), stampOf(scene));
}

/** Whether the cache of `scene` is missing, compiled with other options, or older than a file of
 *  its source or than the compiler built at `compiled`. */
export function isStale(scene: CookedScene, root = ROOT, compiled = compilerTime()): boolean {
  const stamp = stampPath(scene, root);
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== stampOf(scene, root)) return true;
  const since = statSync(stamp).mtimeMs;
  return (compiled ?? 0) > since || firstNewer(sourceOf(scene, root), since) !== null;
}

/** Compiles every stale cache. Without a compiler, a `required` run throws; another names what it
 *  left and goes on, for a caller that may read none of them. */
export function compileSiteCaches(required = true): void {
  const compiled = compilerTime();
  const stale = Object.values(COOKED_SCENES).filter((scene) => isStale(scene, ROOT, compiled));
  if (!stale.length) return;
  try {
    requireNativeCompiler();
  } catch (error) {
    if (required) throw error;
    const names = stale.map((scene) => scene.directory).join(', ');
    console.warn(`Scene caches not compiled (${(error as Error).message}): ${names}.`);
    return;
  }
  for (const scene of stale) compileCache(scene);
}

if (import.meta.filename === process.argv[1]) compileSiteCaches();
