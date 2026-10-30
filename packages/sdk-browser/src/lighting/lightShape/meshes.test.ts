// The light shapes' meshes (`meshes.ts`): the counts the reference's meshes have, every index inside the vertices, the shapes they draw.
import test from 'node:test'
import assert from 'node:assert/strict'
import { edgeIndices, pointMesh, rectMesh, spotMesh } from './meshes.ts'

test('the meshes have the vertices and triangles the reference’s do', () => {
  const point = pointMesh(),
    spot = spotMesh(),
    rect = rectMesh()
  assert.deepEqual([point.vertices.length / 3, point.triangles.length / 3], [559, 960])
  assert.deepEqual([spot.vertices.length / 3, spot.triangles.length / 3], [396, 704])
  assert.deepEqual([rect.vertices.length / 3, rect.triangles.length / 3], [9 * 57, 8 * 14 * 4 * 2])
})

test('every index of every mesh names a vertex, and the edge list is the three edges of each triangle', () => {
  for (const mesh of [pointMesh(), spotMesh(), rectMesh()]) {
    const count = mesh.vertices.length / 3
    for (const index of mesh.triangles) assert.ok(index < count)
    const lines = edgeIndices(mesh)
    assert.equal(lines.length, mesh.triangles.length * 2)
    assert.deepEqual(
      [...lines.slice(0, 6)],
      [
        mesh.triangles[0],
        mesh.triangles[1],
        mesh.triangles[1],
        mesh.triangles[2],
        mesh.triangles[2],
        mesh.triangles[0],
      ],
    )
  }
})

test('the point mesh lies on the unit sphere, the spot’s rim on the unit circle and the rectangle’s box in the unit square across its barn doors', () => {
  const point = pointMesh()
  for (let i = 0; i < point.vertices.length; i += 3)
    assert.ok(
      Math.abs(Math.hypot(point.vertices[i], point.vertices[i + 1], point.vertices[i + 2]) - 1) <
        1e-6,
    )
  const spot = spotMesh()
  for (let i = 0; i < spot.vertices.length; i += 3) {
    assert.ok(spot.vertices[i] >= 0 && spot.vertices[i] <= 1.1 + 1e-6)
    assert.ok(Math.abs(Math.hypot(spot.vertices[i + 1], spot.vertices[i + 2]) - 1) < 1e-6)
  }
  const rect = rectMesh()
  for (let i = 0; i < rect.vertices.length; i += 3) {
    const [x, y, z] = [rect.vertices[i], rect.vertices[i + 1], rect.vertices[i + 2]]
    assert.ok(
      x >= -1 / 14 - 1e-6 && x <= 0.5 + 1e-6,
      'from the barn doors’ edge, a seventh behind the rectangle, to the far end',
    )
    assert.ok(Math.max(Math.abs(y), Math.abs(z)) - 0.5 < 1e-6)
  }
})
