import test from 'node:test'
import assert from 'node:assert/strict'
import { createTextureLevelReader, type TextureLevelRequest } from './levelReader.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'
import { tiledLevelFile } from './tileRecords.fixture.ts'
import { poolEncoding } from './blockFormats.ts'

/** The white texel of the opaque lane, as the pool's encoding pins it (`PoolEncoding.whiteOf`). */
const WHITE_TAIL = poolEncoding(undefined).whiteOf('lossless')

const SHA = 'b'.repeat(64)
const BASE = 'https://host/cache/full/clusters.json'
const manifest = {
  textures: { url: '../../textures/v6/{sha}/{kind}-{level}.{format}', version: 6 },
  key: 'k1',
}

/** A fetch that serves what the test gives it, and records the address asked. */
function serve(bytes: Uint8Array<ArrayBuffer>) {
  const asked: string[] = []
  globalThis.fetch = (async (url: string | URL) => {
    asked.push(String(url))
    return new Response(bytes, { status: 200 })
  }) as typeof fetch
  return asked
}

// Behaviour: a block level is read by its tile's record at the address of its format — the
// file's head of record ends, then the record, inflated —, as the blocks the compiler wrote; the
// lossless lane's read decodes those blocks to RGBA8, four bytes a texel; a level read whole brings
// every record at once.
test('a tile of a block level is read as its record’s blocks, or decoded to RGBA8', async () => {
  const white = WHITE_TAIL.blocks.bc7[0]!
  const whiteRecord = (_: number, bytes: number) =>
    Uint8Array.from({ length: bytes }, (_, i) => white[i % 16]!)
  const { file, records } = tiledLevelFile(256, 256, whiteRecord)
  const reader = createTextureLevelReader(manifest, BASE, createPageCache())!
  const asked = serve(file)
  const tile: TextureLevelRequest = {
    ...{ sha256: SHA, atlas: 1, level: 1, format: 'bc7' },
    ...{ size: [256, 256], tx: 1, ty: 0 },
  }
  const blocks = await reader(tile)
  assert.equal(asked[0], `https://host/textures/v6/${SHA}/linear-1.bc7`)
  assert.deepEqual(blocks, records[1])
  const rgba = await reader({ ...tile, ty: 1, rgba: true })
  assert.equal(rgba.byteLength, records[3]!.byteLength * 4)
  assert.ok(
    rgba.every((byte) => byte === 255),
    'the white block decodes white',
  )
})
