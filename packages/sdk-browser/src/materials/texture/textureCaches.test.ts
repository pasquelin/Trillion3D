// A cache keeping its previews' RGBA8 tails in a file of their own: that file is read once, by a
// session that pins them, and by none that samples blocks.
import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { decodeManifestBinary } from '../../../../sdk-core/src/manifest/binaryDecode.ts'
import { preview } from '../../../../../tests/fixtures/manifest/manifestBinaryPreview.ts'
import {
  encode,
  encodeExternal,
} from '../../../../../tests/fixtures/manifest/manifestBinaryPreviewSidecar.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'
import { poolEncoding } from './blockFormats.ts'
import { createTextureCaches } from './textureCaches.ts'

const BASE = 'https://host/cache/full/'
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** A caches object holding one cache of three previews whose pixels lie in a file, and the
 *  addresses asked of the file. */
function held() {
  const previews = [preview(0, 40, 24, 1), preview(1, 16, 16, 3), preview(2, 8, 8, 5)]
  const whole = encode(previews)
  const inline = decodeManifestBinary(whole.slim, whole.buffer).texturePreviews!
  const { slim, buffer, pixels } = encodeExternal(previews)
  const manifest = decodeManifestBinary(slim, buffer)
  const asked: string[] = []
  const served = { file: new Uint8Array(pixels) }
  globalThis.fetch = (async (url: string | URL) => {
    asked.push(String(url))
    return new Response(served.file, { status: 200 })
  }) as typeof fetch
  const caches = createTextureCaches(createPageCache())
  caches.add({ ranks: new Map(), metadata: manifest, base: BASE })
  return {
    caches,
    asked,
    inline,
    manifest,
    served,
    pixels,
    entries: manifest.texturePreviews!,
  }
}

test('a session sampling blocks fetches no preview pixels', async () => {
  const { caches, asked, entries } = held()
  await caches.ensureLevels(poolEncoding('bc7'))
  assert.deepEqual(asked, [])
  assert.ok(entries.every((entry) => entry.levels.every((level) => level.length === 0)))
})

test('a session pinning RGBA8 tails fetches the file once and gets the inline levels', async () => {
  const { caches, asked, inline, entries } = held()
  const rgba8 = poolEncoding(undefined)
  await Promise.all([caches.ensureLevels(rgba8), caches.ensureLevels(rgba8)])
  await caches.ensureLevels(rgba8)
  assert.deepEqual(asked, [`${BASE}preview-pixels.bin`])
  assert.deepEqual(entries, inline)
})

test('a file that verifies but fails to fill is read again by a later call, no level half written', async () => {
  const { caches, asked, inline, manifest, served, pixels, entries } = held()
  const whole = manifest.texturePreviewPixels!
  // A file a byte short, whose own size and fingerprint the manifest names: it verifies, the fill refuses it.
  const short = pixels.subarray(0, pixels.length - 4)
  served.file = new Uint8Array(short)
  manifest.texturePreviewPixels = {
    ...whole,
    bytes: short.length,
    sha256: createHash('sha256').update(short).digest('hex'),
  }
  const rgba8 = poolEncoding(undefined)
  await assert.rejects(caches.ensureLevels(rgba8), /pixel file is too short/)
  assert.ok(entries.every((entry) => entry.levels.every((level) => level.length === 0)))
  manifest.texturePreviewPixels = whole
  served.file = new Uint8Array(pixels)
  await caches.ensureLevels(rgba8)
  assert.equal(asked.length, 2)
  assert.deepEqual(entries, inline)
})
