import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { Color } from '../../../sdk-core/src/world/math/color.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import { surfaceOf } from '../page/surface.ts'
import { pageRecFixture } from '../../../../bench/perf/browser/support/pageRecFixture.ts'
import { createPageRowWriter } from '../webgpu/row/pageRowWriter.ts'
import { createMaterialTable } from '../webgpu/material/materialTable.ts'
import { BLEND_ITEM_WORDS, writeBlendItemRecord } from '../webgpu/blend/items.ts'
import { BLEND_ITEM_SHIPPED } from '../webgpu/blend/itemLayout.fixture.ts'
import { ROW_WORDS } from '../visibility/types.ts'
import { PAGE_INFO } from '../visibility/pageInfo.ts'

const material = () =>
  G.physicalSurface({
    side: 'double',
    transmission: 0.5,
    thickness: 2,
    subsurfaceColor: new Color().setRGB(0.25, 0.5, 0.75),
  })

test("a row's deformation words are its own, its neighbour's untouched", () => {
  const rec = pageRecFixture({
    triangles: 1,
    material: surfaceOf(material()),
  })
  const write = createPageRowWriter(
    {
      mapLayer: new Map(),
      dataLayer: new Map(),
      geometryBlocks: new Map(),
      asIsShown: false,
      emissiveAoShown: false,
      deformation: { rowWord: () => 123 },
      materialTable: createMaterialTable(),
    },
    () => {},
    [{ world: new Matrix4() }],
    () => 0,
    () => ({ from: 10, count: 3 }),
  )
  const floats = new Float32Array(ROW_WORDS * 2)
  const words = new Uint32Array(floats.buffer)
  write(rec, 0, 1, 100, floats, words)
  const base = ROW_WORDS
  assert.ok(floats.subarray(0, base).every((value) => value === 0))
  assert.deepEqual(
    [
      words[base + PAGE_INFO.at.deform],
      words[base + PAGE_INFO.at.deformCount],
      words[base + PAGE_INFO.at.deformOutput],
    ],
    [123, 3, 11],
  )
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
      matrix: new Matrix4(),
      flags: 1,
      count: 3,
      sourceGeometry: new Geometry(),
      paged: true,
      deformInput: 456,
      deformOutput: 789,
    },
    { mapLayer: new Map(), dataLayer: new Map(), deformation: { wordOfWorld: () => 123 } },
  )
  const base = BLEND_ITEM_WORDS
  assert.ok(floats.subarray(0, base).every((value) => value === 0))
  const { at } = BLEND_ITEM_SHIPPED
  assert.deepEqual(
    [base + at.deform, base + at.deformInput, base + at.deformOutput].map((i) => words[i]),
    [123, 456, 789],
  )
})
