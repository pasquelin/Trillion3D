// The fold limit of `edges` is the cosine of `thresholdAngle · DEG2RAD`, the engine's one degree
// rule (`math.degToRad`), where it was `(thresholdAngle · π) / 180`: the two can round a last bit
// apart. On the built shapes, at every whole and tenth of a degree and the sweep's angles, no edge
// changes side.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEG2RAD } from '../../../../math/src/constants.ts'
import {
  HALTON_SWEEP,
  edgeValues,
  haltonSpan,
} from '../../../../math/src/sequence/sweep.fixture.ts'
import { geometry } from './index.ts'
import { edgesOf } from './lines.ts'

/** The fold test of `edges`, with the limit it is given. */
const folds = (normals: number[][], limit: number) =>
  normals.length < 2 ||
  normals[0][0] * normals[1][0] + normals[0][1] * normals[1][1] + normals[0][2] * normals[1][2] <=
    limit

test('edges keeps the same edges with the limit cos(angle · DEG2RAD)', () => {
  const shapes = [
    geometry.box(1, 1, 1, 2, 3, 4),
    geometry.sphere(1, 24, 16),
    geometry.cylinder(1, 0.5, 2, 20, 3),
    geometry.cone(1, 2, 13),
    geometry.torus(1, 0.3, 12, 24),
    geometry.torusKnot(1, 0.3, 48, 8),
    geometry.capsule(0.5, 1, 6, 12),
    geometry.polyhedron(
      [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1],
      [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5],
      1,
      2,
    ),
  ]
  const normals = shapes.flatMap((shape) => [...edgesOf(shape).values()].map((e) => e.normals))
  const angles = [
    ...Array.from({ length: 1801 }, (_, i) => i / 10),
    ...Array.from({ length: HALTON_SWEEP }, (_, i) => haltonSpan(i + 1, 2, 0, 180)),
    ...edgeValues(0, 180),
  ]
  let apart = 0,
    moved = 0
  for (const angle of angles) {
    const old = Math.cos((angle * Math.PI) / 180),
      now = Math.cos(angle * DEG2RAD)
    if (old === now) continue
    apart++
    for (const pair of normals) if (folds(pair, old) !== folds(pair, now)) moved++
  }
  assert.ok(apart > 0, 'the sweep meets limits a last bit apart')
  assert.equal(moved, 0)
})
