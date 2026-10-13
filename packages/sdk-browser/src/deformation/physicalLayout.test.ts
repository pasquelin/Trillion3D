import test from 'node:test'
import assert from 'node:assert/strict'
import { hostSide } from '../scene/materialSide.ts'
import * as G from '../host/graph/graph.fixture.ts'
import { surfaceOf } from '../page/surface.ts'
import { pageRecFixture } from '../../../../bench/perf/browser/support/pageRecFixture.ts'
import { createPageRowWriter } from '../webgpu/row/pageRowWriter.ts'
import { BLEND_ITEM_WORDS, writeBlendItemRecord } from '../webgpu/blend/items.ts'
import { ROW_WORDS } from '../visibility/types.ts'
import { PAGE_INFO } from '../visibility/pageInfo.ts'

const material = () =>
  new G.GraphSurface('physical', {
    side: hostSide('double'),
    transmission: 0.5,
    thickness: 2,
    subsurfaceColor: new G.Color().setRGB(0.25, 0.5, 0.75),
  })

test('paged deformation metadata cannot overwrite transmission or thin-surface color', () => {
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
    },
    () => {},
    [{ world: new G.Matrix4() }],
    () => 0,
    () => ({ from: 10, count: 3 }),
  )
  const floats = new Float32Array(ROW_WORDS * 2)
  const words = new Uint32Array(floats.buffer)
  write(rec, 0, 1, 100, floats, words)
  const base = ROW_WORDS
  assert.ok(floats.subarray(0, base).every((value) => value === 0))
  assert.equal(floats[base + 38], 0.5)
  assert.equal(floats[base + 39], 2)
  assert.deepEqual([floats[base + 52], floats[base + 53], floats[base + 58]], [0.25, 0.5, 0.75])
  assert.deepEqual(
    [
      words[base + PAGE_INFO.at.deform],
      words[base + PAGE_INFO.at.deformCount],
      words[base + PAGE_INFO.at.deformOutput],
    ],
    [123, 3, 11],
  )
})

test('transparent deformation and subsurface records occupy distinct words', () => {
  const floats = new Float32Array(BLEND_ITEM_WORDS * 2),
    words = new Uint32Array(floats.buffer)
  writeBlendItemRecord(
    floats,
    words,
    1,
    {
      surface: surfaceOf(material()),
      matrix: new G.Matrix4(),
      flags: 1,
      count: 3,
      sourceGeometry: new G.Geometry(),
      paged: true,
      deformInput: 456,
      deformOutput: 789,
    },
    { mapLayer: new Map(), dataLayer: new Map(), deformation: { wordOfWorld: () => 123 } },
  )
  const base = BLEND_ITEM_WORDS
  assert.ok(floats.subarray(0, base).every((value) => value === 0))
  assert.deepEqual([...floats.subarray(base + 44, base + 47)], [0.25, 0.5, 0.75])
  assert.deepEqual([...words.subarray(base + 48, base + 51)], [123, 456, 789])
})
