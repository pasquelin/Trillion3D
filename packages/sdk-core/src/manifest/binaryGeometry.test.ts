import { BINARY, sha, manifest } from '../../../../tests/fixtures/manifest/manifestBinary.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeManifestBinary } from './binaryDecode.ts'
import { READ_MANIFEST_VERSIONS } from './binaryTypes.ts'
import { encodeManifestBinary } from '../../../../tests/fixtures/manifest/manifestBinaryEncode.ts'
import type { EngineError } from '../contracts/cache.ts'

/** The oldest manifest binary version read: its previews' pixels inline in the head sidecar. */
const INLINE_PIXELS_VERSION = READ_MANIFEST_VERSIONS.at(-1)!

function encoded() {
  const { manifest: slim, binary } = encodeManifestBinary(manifest(), BINARY)
  slim.binary.sha256 = sha('f')
  const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength)
  return { slim, buffer: buffer as ArrayBuffer }
}

test('a page is read as a slice of its bundle, a range of the container its file rank names', () => {
  const { slim, buffer } = encoded()
  const { pages, streams } = decodeManifestBinary(slim, buffer).primitives[0]
  const file = BINARY.geometryFiles[0].url,
    [first, second] = pages
  assert.deepEqual(streams!.pages[1].range, { file, offset: 32 })
  assert.equal(streams!.pages[1].url, `${file}#bundle-32`)
  assert.deepEqual(second.geometry!.bundle, { url: `${file}#bundle-32`, offset: 0 })
  assert.equal(second.url, `${file}#32`, 'a page never shares its bundle name')
  assert.equal(second.url, second.geometry!.url)
  assert.equal(second.sha256, streams!.pages[1].sha256, 'proven by its bundle')
  assert.deepEqual(streams!.pages[1].dependencies, [0])
  assert.equal(first.bytes, first.geometry!.bytes)
})

test('a bundle in a geometry file the manifest does not name is refused', () => {
  const { slim, buffer } = encoded()
  slim.geometryFiles = []
  assert.throws(
    () => decodeManifestBinary(slim, buffer),
    (error: EngineError) => error.code === 'INVALID_CACHE',
  )
})

test('a sidecar written before the geometry bundles is refused before it is read', () => {
  // Each version before the oldest one still read (the pixels inline, `INLINE_PIXELS_VERSION`),
  // those before the geometry bundles included, is refused, none read.
  for (const version of Array.from({ length: INLINE_PIXELS_VERSION - 7 }, (_, at) => 7 + at)) {
    const { slim, buffer } = encoded()
    new Uint32Array(buffer, 4, 1)[0] = version
    assert.throws(
      () => decodeManifestBinary(slim, buffer),
      (error: EngineError) => error.code === 'UNSUPPORTED_FORMAT',
    )
  }
})
