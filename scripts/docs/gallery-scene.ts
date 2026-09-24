// The two proofs every published gallery scene carries (`docs-gallery.ts` writes them): its source
// rebuilt byte for byte by its recipe, and its cache manifest read back.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
