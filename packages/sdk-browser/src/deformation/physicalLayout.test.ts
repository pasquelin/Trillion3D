import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { Color } from '../../../sdk-core/src/world/math/color.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import { surfaceOf } from '../geometry/pages/surface.ts'
import { createMaterialTable } from '../materials/table/materialTable.ts'
import { BLEND_ITEM_WORDS, writeBlendItemRecord } from '../blend/items.ts'
import { emptyGeometryBlock } from '../geometry/rows/page/pageRowMaterial.ts'
import { BLEND_ITEM_SHIPPED } from '../blend/itemLayout.fixture.ts'

const material = () =>
  G.physicalSurface({
    side: 'double',
    transmission: 0.5,
    thickness: 2,
    subsurfaceColor: new Color().setRGB(0.25, 0.5, 0.75),
  })

test("a transparent item's deformation words are its own, its neighbour's untouched", () => {
  const floats = new Float32Array(BLEND_ITEM_WORDS * 2),
    words = new Uint32Array(floats.buffer)
  writeBlendItemRecord(
    floats,
    words,
    1,
    {
      surface: surfaceOf(material()),
      priority: 0,
      matrix: new Matrix4(),
      flags: 1,
      sourceGeometry: new Geometry(),
      geometry: emptyGeometryBlock(),
    },
    {
      mapLayer: new Map(),
      dataLayer: new Map(),
      deformation: { wordOfWorld: () => 123 },
      materialTable: createMaterialTable(),
    },
  )
  const base = BLEND_ITEM_WORDS
  assert.ok(floats.subarray(0, base).every((value) => value === 0))
  const { at } = BLEND_ITEM_SHIPPED
  assert.equal(words[base + at.deform], 123)
})
