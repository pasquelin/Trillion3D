// The JavaScript decoder of a quantized cluster page against the page encoder of the SDK
// module (`packages/page-codec-wasm`), the one the compiler writes with: triangles identical, every
// attribute within what its grid holds, vertices on the same cells kept once, and the refusals of
// the format in their order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeGeometryPage } from './geometryPage.ts'
import { encodePage } from './encodePage.fixture.ts'
import { ringMesh } from './ringMesh.fixture.ts'
import { DEG2RAD } from '../../../../math/src/constants.ts'

test('a page decodes to its triangles, every attribute within what its grid holds', () => {
  const { encoded, indices, attributes } = ringMesh(40, 3, 3)
  assert.ok(attributes.POSITION && attributes.NORMAL && attributes.TEXCOORD_0 && attributes.COLOR_0)
  const decoded = decodeGeometryPage(encoded.data)
  assert.equal(decoded.vertexCount, 42)
  assert.equal(decoded.flags, 1 | 2 | 4 | 8)
  assert.equal(decoded.decodedBytes, encoded.uncompressedBytes)
  assert.deepEqual(Object.keys(decoded.attributes), ['position', 'normal', 'uv', 'uv1', 'color'])
  assert.equal(decoded.indices.buffer, decoded.attributes.color.buffer)
  // Cells of an eighth of a centimetre, and the float's own step at a hundred metres.
  const step = 2 ** -3 * 0.01
  for (let corner = 0; corner < indices.length; corner++) {
    const local = decoded.indices[corner],
      source = indices[corner]
    let distance = 0,
      dot = 0
    for (let c = 0; c < 3; c++) {
      distance +=
        (decoded.attributes.position[local * 3 + c] - attributes.POSITION.array[source * 3 + c]) **
        2
      dot += decoded.attributes.normal[local * 3 + c] * attributes.NORMAL.array[source * 3 + c]
    }
    assert.ok(Math.sqrt(distance) <= (step * Math.sqrt(3)) / 2 + 1e-5, `position ${corner}`)
    assert.ok(Math.acos(Math.min(1, dot)) < 1 * DEG2RAD, `normal ${corner}`)
    for (let c = 0; c < 2; c++)
      assert.ok(
        Math.abs(
          decoded.attributes.uv[local * 2 + c] - attributes.TEXCOORD_0.array[source * 2 + c],
        ) <=
          2 ** -15 + 1e-9,
      )
    assert.ok(
      Math.abs(decoded.attributes.color[local * 4] - attributes.COLOR_0.array[source * 3]) <=
        0.5 / 255 + 1e-6,
    )
    assert.equal(decoded.attributes.color[local * 4 + 3], 1)
  }
})

test('vertices that land on the same cells are kept once and the indices remapped', () => {
  const position = new Float32Array([0, 0, 0, 1, 0, 0, 1 + 2 ** -12, 0, 0, 0, 1, 0])
  const encoded = encodePage([0, 1, 3, 0, 2, 3], { POSITION: { itemSize: 3, array: position } }, 0)
  const decoded = decodeGeometryPage(encoded.data)
  assert.equal(decoded.vertexCount, 3)
  assert.deepEqual(Array.from(decoded.indices), [0, 1, 2, 0, 1, 2])
  assert.deepEqual(Array.from(decoded.attributes.position.subarray(3, 6)), [1, 0, 0])
})

test('the encoder refuses a page too wide for its grid instead of re-gridding it', () => {
  const wide = {
    POSITION: { itemSize: 3, array: new Float32Array([0, 0, 0, 2 ** 20, 0, 0, 0, 1, 0]) },
  }
  assert.throws(() => encodePage([0, 1, 2], wide, 0), /PAGE_ATTRIBUTE_RANGE/)
})

test('a short header, a wrong version, a field beyond the format, a truncation and a forged influence count are refused in that order', () => {
  const { encoded } = ringMesh(4, 3)
  assert.throws(() => decodeGeometryPage(encoded.data.subarray(0, 16)), /GEOMETRY_PAGE_HEADER/)
  const version = Uint8Array.from(encoded.data)
  version[4] = 2
  assert.throws(() => decodeGeometryPage(version), /GEOMETRY_PAGE_VERSION/)
  const wide = Uint8Array.from(encoded.data)
  wide[20] = 22 // Position x width: 22 of the 6 bits, above 21.
  assert.throws(() => decodeGeometryPage(wide), /GEOMETRY_PAGE_BOUNDS/)
  assert.throws(
    () => decodeGeometryPage(encoded.data.subarray(0, encoded.data.length - 4)),
    /GEOMETRY_PAGE_BOUNDS/,
  )
  assert.throws(() => decodeGeometryPage(encoded.data, 16), /GEOMETRY_PAGE_BOUNDS/)
  const forged = Uint8Array.from(encoded.data)
  forged[88] = 0xff // An influence count on a page with no skin: the header gate refuses it.
  assert.throws(() => decodeGeometryPage(forged), /GEOMETRY_PAGE_BOUNDS/)
})

test('a page view off the word boundary decodes bit for bit like the aligned one', () => {
  const { encoded } = ringMesh(40, 3, 3)
  const padded = new Uint8Array(encoded.data.length + 1)
  padded.set(encoded.data, 1)
  const aligned = decodeGeometryPage(encoded.data)
  const shifted = decodeGeometryPage(new Uint8Array(padded.buffer, 1, encoded.data.length))
  assert.deepEqual(shifted.indices, aligned.indices)
  assert.deepEqual(shifted.attributes, aligned.attributes)
})

test('a forged index count is refused before the decoder allocates', () => {
  // One vertex, so indices cost no bits and the layout still matches the header alone; three
  // times 2^30 indices, whose byte count wraps a 32-bit size to zero without saturation.
  const { data } = encodePage([0, 0, 0], {
    POSITION: { itemSize: 3, array: new Float32Array([1, 2, 3]) },
  })
  const forged = (data as Uint8Array).slice()
  new DataView(forged.buffer).setUint32(3 * 4, 3 * 2 ** 30, true)
  assert.throws(() => decodeGeometryPage(forged.slice(), 1 << 24), /GEOMETRY_PAGE_BOUNDS/)
})
