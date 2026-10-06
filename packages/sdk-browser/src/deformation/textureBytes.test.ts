import test from 'node:test'
import assert from 'node:assert/strict'
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import { BufferAttribute } from '../../../sdk-core/src/world/buffer/attribute.ts'
import { geometryDeformationBytes, pageDeformationBytes } from './textureBytes.ts'
import { deformationTexels } from './vertexTexture.ts'
import { hostPageBytes } from '../host/pageObjects.ts'
import { FLAG_SKIN, FLAG_MORPH } from '../cluster/format.ts'
import { drawGeometryPool } from '../backend/autonomous/poolDraw.ts'
import type { GeometryPageDescriptor } from '../../../sdk-core/src/page/contracts.ts'

function geometry(vertices: number) {
  const source = new Geometry()
  for (const [name, width] of [
    ['position', 3],
    ['skinIndex', 8],
    ['skinWeight', 8],
    ['morph', 6],
  ] as const)
    source.setAttribute(name, new BufferAttribute(new Float32Array(vertices * width), width))
  return source
}

test('all source texture padding is reserved with resident geometry, including tiny pages', () => {
  for (const vertices of [3, 1200]) {
    const source = geometry(vertices)
    const decoded = vertices * 25 * 4
    const actual = Math.ceil(deformationTexels(source, 1).byteLength / 16384) * 16384
    assert.equal(geometryDeformationBytes(source), actual)
    assert.equal(hostPageBytes(source), decoded + actual)
    const page = {
      uncompressedBytes: decoded,
      flags: FLAG_SKIN | FLAG_MORPH,
    } as GeometryPageDescriptor
    assert.ok(pageDeformationBytes(page) >= actual, 'admission covers every padded source row')
  }
})

test('source texture reservations and pinned controls reduce slots in the existing pool', () => {
  const page = { uncompressedBytes: 300, flags: FLAG_SKIN } as GeometryPageDescriptor
  const pageBytes = 300 + 16384,
    fixedBytes = 32768
  const drawn = drawGeometryPool({
    budgetBytes: fixedBytes + 3 * pageBytes,
    descriptors: new Map([['page', page]]),
    fixedBytes: () => fixedBytes,
    rootUrls: new Set(),
    coverRevision: () => 0,
    copies: { of: () => 1, root: () => 1, floor: () => 1, scene: () => 100 },
  })
  assert.equal(drawn.current().slots, 3)
  assert.equal(drawn.current().allocatedBytes, fixedBytes + 3 * pageBytes)
  drawn.resize(fixedBytes + pageBytes)
  assert.equal(drawn.current().slots, 1)
  assert.equal(drawn.current().allocatedBytes, fixedBytes + pageBytes)
})
