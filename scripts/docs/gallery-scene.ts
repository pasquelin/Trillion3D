// What the offline gallery scenes share: compiling a scene's `source/` into its `cache/` with the
// native compiler, and the two proofs every published scene carries — its source rebuilt byte for
// byte by its recipe, and its cache manifest read back.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Compiles `<directory>/source/geometry.gltf` into `<directory>/cache` with the full pass at the
 *  budgets every gallery scene uses, and returns the compiler's exit status. The compiler is
 *  `TRILLION3D_COMPILER`, or the release build; one that cannot start throws. */
export function compileGalleryScene(root: string, directory: string, simplification: string) {
  const compiler =
    process.env.TRILLION3D_COMPILER ??
    resolve(root, 'packages/asset-compiler-rust/target/release/trillion3d-compiler');
  const result = spawnSync(
    compiler,
    [
      'source/geometry.gltf',
      'cache',
      'full',
      '150000',
      '2',
      '256',
      '../../../../source/',
      simplification,
    ],
    // Relative paths from the scene folder: the compiler records the paths it is given.
    { cwd: directory, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  return result.status;
}

/** Asserts that `write`, run in a throwaway folder, rebuilds the published source byte for byte. */
export async function assertSourceReproduced(
  published: string,
  prefix: string,
  write: (directory: string) => Promise<void>,
) {
  const temporary = await mkdtemp(join(tmpdir(), prefix));
  try {
    await write(temporary);
    for (const file of ['geometry.gltf', 'geometry.bin'])
      assert.deepEqual(
        await readFile(join(temporary, file)),
        await readFile(join(published, 'source', file)),
      );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Shape of one native compiler cache manifest, as persisted on disk. */
export interface CacheManifest {
  sourceTriangles: number;
  selectedTriangles: number;
  primitives: unknown[];
  scenePlugin: { name: string };
}

/** The cache manifest a published scene's full pass points at. */
export async function publishedManifest(published: string): Promise<CacheManifest> {
  const directory = resolve(published, 'cache/native/full'),
    pointer = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as {
      url: string;
    };
  return JSON.parse(await readFile(resolve(directory, pointer.url), 'utf8')) as CacheManifest;
}
