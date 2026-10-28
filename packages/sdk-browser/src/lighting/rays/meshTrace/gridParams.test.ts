// The grid of the meshes' fields trace: the cells along the view and the slices of depth, the room of the lists and the
// uniform the passes read.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MESH_DISTANCE_FIELD_TRACE_RULES,
  resolveMeshDistanceFieldTrace,
  type MeshDistanceFieldTraceValues,
} from '../../../../../sdk-core/src/contracts/meshDistanceFieldTraceOptions.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import {
  gridCellCount,
  gridEntryCapacity,
  meshGridShape,
  writeMeshGridParams,
} from './gridParams.ts'
import { MESH_GRID_FLAG, MESH_GRID_PARAMS } from './layout.ts'

const defaults = () =>
  resolveSettings(MESH_DISTANCE_FIELD_TRACE_RULES, {}) as MeshDistanceFieldTraceValues
const settings = (values: Partial<MeshDistanceFieldTraceValues> = {}) =>
  resolveMeshDistanceFieldTrace({ ...defaults(), ...values })

test('the trace is off by default, as the reference leaves it, and on once switched', () => {
  assert.equal(settings().enabled, false)
  assert.equal(settings({ meshDistanceFieldTrace: true }).enabled, true)
  assert.equal(
    settings({ meshDistanceFieldTrace: true, meshDistanceFieldTraceAllow: false }).enabled,
    false,
  )
  assert.equal(
    settings({ meshDistanceFieldTrace: true, meshDistanceFieldDetailTraces: false }).enabled,
    false,
  )
})

test('a cell is 64 pixels and the slices number the doublings of the span to the end distance', () => {
  const shape = meshGridShape([1920, 1080], 10, 4000, settings())
  // log2((4000 - 10) * 0.01) * 4 = 21.2: 21 slices and one.
  assert.deepEqual(shape.cells, [30, 17, 22])
  assert.equal(shape.pixelShift, 6)
  assert.deepEqual([...shape.law], [0.01, 1, 4])
  // A cell size that is no power of two is rounded down to one.
  assert.equal(
    meshGridShape([100, 100], 10, 4000, settings({ meshDistanceFieldTraceCullGridPixelSize: 100 }))
      .pixelShift,
    6,
  )
  // A span too short to double has the one slice.
  assert.equal(meshGridShape([64, 64], 10, 20, settings()).cells[2], 1)
})

test('the lists have the room the average count gives, held to a binding', () => {
  assert.equal(gridEntryCapacity(100, settings(), 1 << 30), 100 * 512)
  assert.equal(gridEntryCapacity(1e6, settings(), 128 << 20), (128 << 20) / 8)
})

test('the uniform holds the grid, the distances and the trace settings', () => {
  const shape = meshGridShape([1920, 1080], 10, 4000, settings())
  const floats = new Float32Array(MESH_GRID_PARAMS.words)
  const words = new Uint32Array(floats.buffer)
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  writeMeshGridParams(floats, words, {
    image: {
      view: [1920, 1080],
      extent: [1920, 1080],
      viewProjection: identity,
      world: identity,
      projection: identity,
      near: 0.1,
      far: 1000,
      perspective: true,
      frame: 13,
    },
    shape,
    settings: settings(),
    scene: {
      objects: 9,
      sphereIndices: 96,
      endDistance: 4000,
      traceDistance: 180,
      sceneDetail: 2,
      entries: 777,
    },
  })
  const at = MESH_GRID_PARAMS.at
  assert.deepEqual([...words.slice(at.grid, at.grid + 4)], [30, 17, 22, 6])
  assert.deepEqual([...words.slice(at.limits, at.limits + 4)], [777, 30 * 17 * 22, 6, 5])
  assert.equal(words[at.counts + 1], 9)
  assert.equal(words[at.counts + 2], 96)
  assert.equal(words[at.counts + 3], MESH_GRID_FLAG.slices)
  assert.deepEqual([...floats.slice(at.distances, at.distances + 3)], [4000, 180, 15])
  assert.ok(Math.abs(floats[at.distances + 3] - 1 / Math.cos(Math.PI / 4)) < 1e-6)
  assert.deepEqual(
    [...floats.slice(at.trace, at.trace + 3)].map((x) => Math.fround(x)),
    [0.6, 32, 0.1].map((x) => Math.fround(x)),
  )
  assert.equal(gridCellCount(shape.cells), 30 * 17 * 22)
})
