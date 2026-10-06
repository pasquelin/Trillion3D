import test from 'node:test'
import assert from 'node:assert/strict'
import { drawnTriangles, lineCorners } from './drawn.ts'
import { BufferAttribute } from '../buffer/index.ts'
import { Geometry } from './geometry.ts'

const attr = (values: number[], width: number) =>
  new BufferAttribute(new Float32Array(values), width)

const position = (values: number[]) => new BufferAttribute(new Float32Array(values), 3)

test('line modes keep unpaired tails out and trace skinned endpoint permutations', () => {
  assert.deepEqual(lineCorners([4, 2, 7, 9, 3], 'lineSegments'), [4, 2, 7, 9])
  assert.deepEqual(lineCorners([4, 2], 'lineLoop'), [4, 2])
  assert.deepEqual(lineCorners([4, 2, 7], 'lineLoop'), [4, 2, 2, 7, 7, 4])
  assert.deepEqual(lineCorners([4], 'lineStrip'), [])
  const g = new Geometry().setAttribute('position', attr([0, 0, 0, 3, 4, 0], 3))
  g.morphAttributes.position = [attr([1, 1, 1, 4, 5, 1], 3)]
  const drawn = drawnTriangles(g, 'lineSegments', { dashed: true })!
  assert.deepEqual([...drawn.sourceVertices!], [0, 0, 1, 1])
  assert.deepEqual([...drawn.uvs!], [0, 0, 0, 0, 5, 0, 5, 0])
  assert.deepEqual([...drawn.indices], [0, 1, 3, 0, 3, 2])
  assert.deepEqual([...drawn.deformation!.targets[0].positions], Array(12).fill(1))
})

test('ordinary points and lines omit deformation lookup and dash storage', () => {
  const g = new Geometry().setAttribute('position', position([0, 0, 0, 3, 4, 0]))
  for (const primitive of ['points', 'lineSegments'] as const) {
    const drawn = drawnTriangles(g, primitive)!
    assert.equal(drawn.sourceVertices, undefined)
    assert.equal(drawn.deformation, undefined)
    assert.equal(drawn.uvs, null)
  }
  const dashed = drawnTriangles(g, 'lineLoop', { dashed: true })!
  assert.deepEqual(Array.from(dashed.uvs!), [0, 0, 0, 0, 5, 0, 5, 0])
})

test('loop quads use unit signed tangents, independent triangle indices and cumulative dash lengths', () => {
  const g = new Geometry().setAttribute('position', position([0, 0, 0, 3, 4, 0, 3, 4, 12]))
  g.morphAttributes.position = [position([1, 0, 0, 4, 4, 0, 4, 4, 12])]
  const drawn = drawnTriangles(g, 'lineLoop', { dashed: true })!
  assert.deepEqual(
    Array.from(drawn.indices),
    [0, 1, 3, 0, 3, 2, 4, 5, 7, 4, 7, 6, 8, 9, 11, 8, 11, 10],
  )
  assert.deepEqual(
    Array.from(drawn.uvs!),
    [0, 0, 0, 0, 5, 0, 5, 0, 5, 0, 5, 0, 17, 0, 17, 0, 17, 0, 17, 0, 0, 0, 0, 0],
  )
  assert.deepEqual(Array.from(drawn.sourceVertices!), [0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0])
  const tangents = [
    [0.6, 0.8, 0],
    [0, 0, 1],
    [-3 / 13, -4 / 13, -12 / 13],
  ]
  for (let segment = 0; segment < 3; segment++)
    for (let corner = 0; corner < 4; corner++)
      for (let c = 0; c < 3; c++) {
        const value = drawn.normals[segment * 12 + corner * 3 + c]
        assert.ok(Math.abs(value - tangents[segment][c] * (corner % 2 ? -1 : 1)) < 1e-7)
      }
})

test('wireframe dash distances continue through every edge and empty line meshes stay empty', () => {
  const g = new Geometry().setAttribute('position', position([0, 0, 0, 3, 0, 0, 0, 4, 0]))
  const wire = drawnTriangles(g, 'triangles', { wireframe: true, dashed: true })!
  assert.equal(wire.lines, true)
  assert.equal(Math.max(...wire.uvs!), 12)
  assert.equal(wire.uvs![wire.uvs!.length - 2], 12)
  for (const vertices of [
    [1, 2, 3],
    [1, 2, 3, 1, 2, 3],
  ]) {
    const empty = new Geometry().setAttribute('position', position(vertices))
    assert.equal(drawnTriangles(empty, 'lineSegments'), null)
  }
})
