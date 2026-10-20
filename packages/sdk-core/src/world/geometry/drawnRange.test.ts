// What a geometry's draw range and vertex colours make of its drawn triangles (`drawn.ts`): the
// corners in range alone, and line quads and point solids tinted as the vertices they come from.
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawnTriangles } from './drawn.ts'
import { BufferAttribute } from '../buffer/attribute.ts'
import { Geometry } from './geometry.ts'

const attr = (values: number[], width: number) =>
  new BufferAttribute(new Float32Array(values), width)

// The draw range picks the corners drawn — of the index, or of the vertices in order —, and any
// write of it, whole or by field, is a change of shape the world cuts again.
test('the draw range limits the drawn corners and counts as a change', () => {
  const g = new Geometry().setAttribute('position', attr([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3))
  g.setIndex([0, 1, 2, 2, 1, 3])
  const before = g.version
  g.drawRange.count = 3
  assert.equal(g.version, before + 1, 'a field write is heard')
  assert.deepEqual([...drawnTriangles(g, 'triangles')!.indices], [0, 1, 2])
  g.setDrawRange(3, Infinity)
  assert.deepEqual([...drawnTriangles(g, 'triangles')!.indices], [2, 1, 3])
  assert.equal(drawnTriangles(g, 'triangles', { wireframe: true })!.indices.length / 6, 3)
  g.drawRange = { start: 1, count: 2 }
  assert.equal(drawnTriangles(g, 'lineStrip')!.indices.length / 6, 1, 'corners 1 and 2')
  assert.equal(drawnTriangles(g, 'points')!.indices.length / 24, 2, 'one octahedron a corner')
  assert.equal(drawnTriangles(g, 'triangles'), null, 'no whole triangle in range')
  g.setIndex(null).setDrawRange(1, 3)
  assert.deepEqual([...drawnTriangles(g, 'triangles')!.indices], [1, 2, 3], 'vertices in order')
  assert.deepEqual(g.clone().drawRange, { start: 1, count: 3 })
})

// A line's quad corners and a point's octahedron keep the colour of the vertex they sit on.
test('line quads and point solids keep their vertices’ colours', () => {
  const g = new Geometry().setAttribute('position', attr([0, 0, 0, 1, 0, 0, 1, 1, 0], 3))
  g.setAttribute('color', attr([1, 0, 0, 0, 1, 0, 0, 0, 1], 3))
  const strip = drawnTriangles(g, 'lineStrip')!
  const rgb = (drawn: typeof strip, v: number) => [...drawn.colors!.subarray(v * 4, v * 4 + 3)]
  assert.deepEqual(
    [0, 1, 2, 3, 4, 7].map((v) => rgb(strip, v)),
    [
      [1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  )
  const dots = drawnTriangles(g, 'points')!
  assert.deepEqual(
    [0, 23, 24, 71].map((v) => rgb(dots, v)),
    [
      [1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  )
  assert.equal(
    drawnTriangles(g, 'points')!.sourceVertices,
    undefined,
    'no trace without deformation',
  )
})
