import test from 'node:test'
import assert from 'node:assert/strict'
import { createTextureLevelReader } from './levelReader.ts'

const SHA = 'b'.repeat(64)
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

// Behaviour: a block level is read as the bytes the file holds, at the address of its format —
// the level store checks their length; a lossless level goes through the
// browser's decoder.
test('a block level is read as bytes at the address of its format', async () => {
  globalThis.createImageBitmap ??= (() => Promise.reject(new Error('unused'))) as never
  const reader = createTextureLevelReader(manifest, 'https://host/cache/full/clusters.json')!
  const asked = serve(new Uint8Array(17 * 3 * 16))
  const level = await reader({ sha256: SHA, atlas: 1, level: 1, format: 'bc7' })
  assert.equal(asked[0], `https://host/textures/v6/${SHA}/linear-1.bc7`)
  assert.ok(level instanceof Uint8Array)
  assert.equal(level.byteLength, 816)
})

// Behaviour: a level that carries its own direct address — an impostor atlas level — is
// read there, through this same reader, and not through the `textures.url` template.
test('a level with its own url is read there, not through the template', async () => {
  globalThis.createImageBitmap = (async () => ({
    width: 2,
    height: 2,
    close() {},
  })) as unknown as typeof createImageBitmap
  const reader = createTextureLevelReader(manifest, 'https://host/cache/full/clusters.json')!
  const asked = serve(new Uint8Array(16))
  const level = await reader({
    sha256: SHA,
    atlas: 0,
    level: 0,
    format: 'png',
    url: '../../objects/aa.bin',
  })
  assert.equal(asked[0], 'https://host/objects/aa.bin')
  assert.ok(level)
})
