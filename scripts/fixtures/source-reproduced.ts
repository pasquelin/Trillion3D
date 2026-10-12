// The two proofs every engine test scene carries: its source
// rebuilt byte for byte by its recipe, and its cache manifest read back.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readCacheManifest } from '../../bench/runner/assets/cacheManifest.ts'

/** Asserts that `write`, run in a throwaway folder, rebuilds the committed source byte for byte. */
export async function assertSourceReproduced(
  committed: string,
  prefix: string,
  write: (directory: string) => Promise<void>,
) {
  const temporary = await mkdtemp(join(tmpdir(), prefix))
  try {
    await write(temporary)
    for (const file of ['geometry.gltf', 'geometry.bin'])
      assert.deepEqual(
        await readFile(join(temporary, file)),
        await readFile(join(committed, 'source', file)),
      )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/** Shape of one native compiler cache manifest, as persisted on disk. */
export interface CacheManifest {
  sourceTriangles: number
  selectedTriangles: number
  primitives: unknown[]
  scenePlugin: { name: string }
}

/** The manifest of the cache compiled from a committed scene's source, full pass. */
export async function compiledManifest(committed: string): Promise<CacheManifest> {
  const { manifest } = await readCacheManifest(resolve(committed, 'cache/native/full'))
  return manifest as unknown as CacheManifest
}
