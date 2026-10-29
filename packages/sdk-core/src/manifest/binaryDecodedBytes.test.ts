import { BINARY, sha, manifest } from '../../../../tests/fixtures/manifest/manifestBinary.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeManifestBinary } from './binaryDecode.ts'
import { columnCountOf, COLUMN_NAMES } from './binaryFormat.ts'
import { READ_MANIFEST_VERSIONS } from './binaryTypes.ts'
import { geometryPageAddress, packedPageAddress } from '../page/contracts.ts'
import { encodeManifestBinary } from '../../../../tests/fixtures/manifest/manifestBinaryEncode.ts'

/** The newest version read with the `bundleDecodedBytes` column, and the newest without it. */
const [WITH_COLUMN, WITHOUT_COLUMN] = [true, false].map((holds) =>
  READ_MANIFEST_VERSIONS.find(
    (version) => (columnCountOf(version) === COLUMN_NAMES.length) === holds,
  )!,
)

/** The fixture's manifest at `version`, its second bundle stored as 20 bytes of 48 when `packed`. */
function encoded(version: number, packed: boolean) {
  const source = manifest()
  source.texturePreviews = []
  if (packed) Object.assign(source.primitives[0].streams!.pages[1], { bytes: 20, decodedBytes: 48 })
  const { manifest: slim, binary } = encodeManifestBinary(source, { ...BINARY, version })
  slim.binary.sha256 = sha('f')
  const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength)
  return { slim, buffer: buffer as ArrayBuffer }
}

test("a version 23 manifest reads each bundle's decoded size and names the pages of a compressed one by it", () => {
  const { slim, buffer } = encoded(WITH_COLUMN, true)
  const { pages, streams } = decodeManifestBinary(slim, buffer).primitives[0]
  const file = BINARY.geometryFiles[0].url,
    [stored, packed] = streams!.pages
  assert.deepEqual([stored.bytes, stored.decodedBytes], [32, undefined], 'stored as it is')
  assert.deepEqual([packed.bytes, packed.decodedBytes], [20, 48])
  assert.equal(pages[0].url, geometryPageAddress(file, 0), 'a stored bundle keeps the old name')
  assert.equal(pages[1].url, packedPageAddress(file, 32, 0))
  assert.equal(pages[1].geometry!.url, pages[1].url)
  assert.equal(pages[1].bytes, 48, 'a page keeps its own decoded size')
})

test('a version 22 manifest reads as before: every bundle stored as it is, pages named by disk offset', () => {
  const { slim, buffer } = encoded(WITHOUT_COLUMN, false)
  const { pages, streams } = decodeManifestBinary(slim, buffer).primitives[0]
  const file = BINARY.geometryFiles[0].url
  for (const bundle of streams!.pages) assert.equal(bundle.decodedBytes, undefined)
  assert.equal(pages[1].url, geometryPageAddress(file, 32))
})
