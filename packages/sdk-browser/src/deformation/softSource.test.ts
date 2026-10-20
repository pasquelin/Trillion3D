import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeformationFrame } from './frame.ts'
import { recordLayout, KIND_SOFT } from './layout.ts'
import { receiveSoftSource, type SoftSource } from './softSource.ts'
import { placementDeformation } from './placementSource.ts'
import type { PlacementRows } from '../placement/rows/rows.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'

const sourceOf = (): SoftSource => ({
  rest: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  normals: new Float32Array(9),
  indices: Uint32Array.of(0, 1, 2),
  version: 1,
  reach: 0,
})

test('cooked simulation uses the same frame record, preserves the previous image and settles', () => {
  const source = sourceOf(),
    shape = { joints: 0, targets: 0, waves: 0, soft: 3 }
  const frame = createDeformationFrame([
    {
      world: new Matrix4(),
      mesh: { softSource: source },
      shape,
      reach: { joints: [], targets: [] },
    },
  ])
  const at = recordLayout(shape).simulation
  assert.equal(
    frame.update(() => false),
    true,
  )
  assert.equal(new Uint32Array(frame.block.buffer)[0], KIND_SOFT)
  const moved = source.rest.map((v, i) => v + (i % 3 === 2 ? 20 : 0))
  assert.equal(receiveSoftSource(source, moved), true)
  assert.equal(frame.pending(), true)
  assert.equal(
    frame.update(() => false),
    true,
  )
  assert.deepEqual(frame.block.slice(at, at + 9), moved)
  assert.deepEqual(frame.block.slice(at + 9, at + 18), source.rest)
  assert.equal(frame.reach[0], 20)
  assert.equal(
    frame.update(() => false),
    true,
  )
  assert.deepEqual(frame.block.slice(at + 9, at + 18), moved)
  assert.equal(
    frame.update(() => false),
    false,
  )
  assert.equal(receiveSoftSource(source, new Float32Array(3)), false)
})

test("a compiled model's cooked soft body drawn at rows deforms by its row's own source", () => {
  // A model's meshes are drawn through instance rows: each row reads its original mesh's
  // simulation, as it reads its skeleton, morph weights and waves.
  const source = sourceOf()
  const rows = { sources: [{}, { softSource: source }] } as unknown as PlacementRows
  const { mesh } = placementDeformation({ rows, index: 1 }, {}, new Map())
  assert.equal(mesh.softSource, source)
  assert.equal(placementDeformation({ rows, index: 0 }, {}, new Map()).mesh.softSource, undefined)
})
