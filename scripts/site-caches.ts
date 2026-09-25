/**
 * The compiled caches of the scenes the site serves and the tests read, which git never tracks
 * (#683): each is compiled from its committed source by this checkout's native compiler — on
 * demand (`pnpm run compile:caches`), by the site build, the unit test runners and `test:gpu`. A
 * cache newer than every file of its source is kept; the regenerators rewrite source and cache.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { modelScenes } from './docs/examples/models.ts';
import { compileFullCache, type FullCompile, nativeCompiler } from './native-compiler.ts';

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

/** Compiles the cache of `scene` again, from nothing. */
export function compileCache({ directory, ...compile }: CookedScene): void {
  const cwd = resolve(ROOT, directory);
  rmSync(resolve(cwd, 'cache'), { recursive: true, force: true });
  compileFullCache({ cwd, ...compile });
  rmSync(resolve(cwd, 'cache/native/.lock'), { force: true });
}

/** Whether the cache of `scene` is missing or older than a file of its source. */
export function isStale({ directory }: CookedScene, root = ROOT): boolean {
  const manifest = resolve(root, directory, 'cache/native/full/manifest.json');
  if (!existsSync(manifest)) return true;
  const source = resolve(root, directory, 'source');
  const compiled = statSync(manifest).mtimeMs;
  return readdirSync(source, { recursive: true }).some(
    (file) => statSync(join(source, String(file))).mtimeMs > compiled,
  );
}

/** Compiles every missing or stale cache. Without a compiler, a `required` run throws; another
 *  names what it left and goes on, for a caller that may read none of them. */
export function compileSiteCaches(required = true): void {
  const stale = Object.values(COOKED_SCENES).filter((scene) => isStale(scene));
  if (!stale.length) return;
  try {
    const compiler = nativeCompiler();
    if (!existsSync(compiler))
      throw new Error(`no compiler at ${compiler}: run \`pnpm run build:native\``);
  } catch (error) {
    if (required) throw error;
    const names = stale.map((scene) => scene.directory).join(', ');
    console.warn(`Scene caches not compiled (${(error as Error).message}): ${names}.`);
    return;
  }
  for (const scene of stale) compileCache(scene);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) compileSiteCaches();
