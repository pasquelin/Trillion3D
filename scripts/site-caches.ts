/**
 * The compiled caches of the scenes the site serves and the tests read, which git never tracks
 * (#683): each is compiled from its committed source by this checkout's native compiler — on
 * demand (`pnpm run compile:caches`), by the site deploy, the unit test runners and `test:gpu`. A
 * cache is kept while its stamp names its compile options and is newer than its source and its
 * compiler; the regenerators rewrite source and cache.
 */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
export interface CookedScene extends Pick<FullCompile, 'source' | 'simplification' | 'stdio'> {
  directory: string;
}

const example = (name: string): CookedScene => ({
  directory: `site/assets/examples/${name}`,
  source: 'source',
  simplification: 'qem-endpoints',
  stdio: ['ignore', 'ignore', 'inherit'],
});

/** Every cooked scene: the examples (the hall's source is committed as is, written by no
 *  script), the gallery's and the two scenes only the tests read. */
export const COOKED_SCENES: Record<string, CookedScene> = {
  ...Object.fromEntries([...Object.keys(modelScenes), 'hall'].map((name) => [name, example(name)])),
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

/** Written beside a compiled cache: the options it was compiled with. */
const STAMP = 'cache/compiled-with.json';
const stampOf = ({ source, simplification = 'none' }: CookedScene) =>
  JSON.stringify({ source, simplification, budget: TRIANGLE_BUDGET });

/** When the compiler was built, or null when there is none to compare with. */
function compilerTime(): number | null {
  try {
    return statSync(nativeCompiler()).mtimeMs;
  } catch {
    return null;
  }
}

/** Compiles the cache of `scene` again, from nothing, and stamps it. */
export function compileCache(scene: CookedScene): void {
  const { directory, ...compile } = scene;
  const cwd = resolve(ROOT, directory);
  rmSync(resolve(cwd, 'cache'), { recursive: true, force: true });
  compileFullCache({ cwd, ...compile });
  rmSync(resolve(cwd, 'cache/native/.lock'), { force: true });
  writeFileSync(resolve(cwd, STAMP), stampOf(scene));
}

/** Whether the cache of `scene` is missing, compiled with other options, or older than a file of
 *  its source or than the compiler built at `compiled`. */
export function isStale(scene: CookedScene, root = ROOT, compiled = compilerTime()): boolean {
  const stamp = resolve(root, scene.directory, STAMP);
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== stampOf(scene)) return true;
  const since = statSync(stamp).mtimeMs;
  return (compiled ?? 0) > since || firstNewer(sourceOf(scene, root), since) !== null;
}

/** Compiles every stale cache. Without a compiler, a `required` run throws; another names what it
 *  left and goes on, for a caller that may read none of them. */
export function compileSiteCaches(required = true): void {
  const stale = Object.values(COOKED_SCENES).filter((scene) => isStale(scene));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) compileSiteCaches();
