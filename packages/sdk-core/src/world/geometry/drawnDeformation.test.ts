import test from 'node:test'
import assert from 'node:assert/strict'
import { Geometry } from './geometry.ts'
import { BufferAttribute, pendingAttribute } from '../buffer/attribute.ts'
import { drawnTriangles, type DrawnTriangles } from './drawn.ts'
import { drawnDeformation, deforms } from './drawnDeformation.ts'
import { skinStreams } from './skin.ts'

const attribute = (values: number[], width = 3) =>
  new BufferAttribute(new Float32Array(values), width)
function triangle() {
  return new Geometry().setAttribute('position', attribute([1, 2, 3, 4, 5, 6, 7, 8, 9]))
}
const array = (a: Float32Array | undefined) => a && Array.from(a)

test('absolute and relative morph positions and normals follow drawn vertex permutations', () => {
  for (const relative of [false, true])
    for (const withNormals of [false, true]) {
      const g = triangle().setIndex([2, 0, 1])
      if (withNormals) g.setAttribute('normal', attribute([1, 0, 0, 0, 1, 0, 0, 0, 1]))
      g.morphTargetsRelative = relative
      g.morphAttributes.position = [
        attribute([2, 4, 6, 8, 10, 12, 14, 16, 18]),
        attribute([0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ]
      g.morphAttributes.normal = [attribute([2, 3, 4, 5, 6, 7, 8, 9, 10])]
      assert.equal(deforms(g), true)
      const drawn = drawnTriangles(g, 'triangles', { flat: true })!
      assert.deepEqual(Array.from(drawn.sourceVertices!), [2, 0, 1])
      const deformation = drawn.deformation!
      assert.equal(deformation.influences, 0)
      assert.equal(deformation.joints, undefined)
      assert.equal(deformation.weights, undefined)
      assert.equal(deformation.targets.length, 2)
      assert.deepEqual(
        array(deformation.targets[0].positions),
        relative ? [14, 16, 18, 2, 4, 6, 8, 10, 12] : [7, 8, 9, 1, 2, 3, 4, 5, 6],
      )
      assert.deepEqual(
        array(deformation.targets[0].normals),
        relative || !withNormals ? [8, 9, 10, 2, 3, 4, 5, 6, 7] : [8, 9, 9, 1, 3, 4, 5, 5, 7],
      )
      assert.deepEqual(array(deformation.targets[1].normals), [0, 0, 0, 0, 0, 0, 0, 0, 0])
      assert.deepEqual(
        array(deformation.targets[1].positions),
        relative ? [0, 0, 0, 0, 0, 0, 0, 0, 0] : [-7, -8, -9, -1, -2, -3, -4, -5, -6],
      )
    }
})

test('paired skin sets retain numeric set order, stored weights and all influences after flattening', () => {
  const g = triangle().setIndex([2, 0, 1])
  g.setAttribute('skinIndex2', attribute([8, 9, 10], 1))
  g.setAttribute('skinWeight2', attribute([0.5, 0.25, 1], 1))
  g.setAttribute('skinIndex', attribute([1, 2, 3, 4, 5, 6], 2))
  g.setAttribute(
    'skinWeight',
    new BufferAttribute(new Uint8Array([255, 0, 0, 255, 51, 204]), 2, true),
  )
  assert.equal(deforms(g), true)
  const d = drawnTriangles(g, 'triangles', { flat: true })!.deformation!
  assert.equal(d.influences, 3)
  assert.deepEqual(array(d.joints), [5, 6, 10, 1, 2, 8, 3, 4, 9])
  const weights = array(d.weights)!
  for (const [i, w] of [51, 204, 1, 255, 0, 0.5, 0, 255, 0.25].entries())
    assert.ok(Math.abs(weights[i] - w) < 1e-7)
  assert.deepEqual(d.targets, [])
  assert.equal(skinStreams(g).read(0, 3, false), 0)
  for (const mismatch of [attribute([1, 2, 3], 1), attribute([1, 2], 2)]) {
    g.setAttribute('skinWeight', mismatch)
    assert.throws(() => skinStreams(g), /Invalid paired skin attributes/)
  }
  g.deleteAttribute('skinWeight')
  assert.throws(() => skinStreams(g), /Invalid paired skin attributes/)
})

test('undeformed geometry retains no metadata and absent source maps preserve source order', () => {
  const g = triangle()
  assert.equal(deforms(g), false)
  g.setAttribute('skinIndexExtra', attribute([1, 2, 3]))
  assert.equal(deforms(g), false)
  assert.equal(drawnDeformation(g, null), null)
  assert.equal(drawnTriangles(g, 'triangles')!.deformation, undefined)
  g.morphAttributes.position = [attribute([2, 3, 4, 5, 6, 7, 8, 9, 10])]
  const drawn: DrawnTriangles = {
    positions: new Float32Array(9),
    normals: new Float32Array(9),
    uvs: null,
    colors: null,
    indices: new Uint32Array([0, 1, 2]),
  }
  assert.equal(drawnDeformation(g, drawn), drawn)
  assert.deepEqual(array(drawn.deformation!.targets[0].positions), [1, 1, 1, 1, 1, 1, 1, 1, 1])
})

test('empty drawn deformation preserves pending skin and morph buffers without reading them', () => {
  for (const kind of ['skin', 'morph']) {
    let reads = 0
    const pending = (size: number) =>
      pendingAttribute(
        {
          length: 0,
          type: 'Float32Array',
          read: async () => {
            reads++
            return new Float32Array()
          },
        },
        size,
        false,
      )
    const g = new Geometry()
    if (kind === 'skin') {
      g.setAttribute('skinIndex', pending(1))
      g.setAttribute('skinWeight', pending(1))
    } else {
      g.morphAttributes.position = [pending(3)]
      g.morphTargetsRelative = true
    }
    const drawn: DrawnTriangles = {
      positions: new Float32Array(),
      normals: new Float32Array(),
      indices: new Uint32Array(),
      uvs: null,
      colors: null,
    }
    assert.equal(drawnDeformation(g, drawn), drawn)
    const d = drawn.deformation!
    assert.equal(reads, 0)
    if (kind === 'skin') {
      assert.deepEqual(d.joints, new Float32Array())
      assert.deepEqual(d.weights, new Float32Array())
      assert.equal(d.influences, 1)
      assert.deepEqual(d.targets, [])
    } else {
      assert.equal(d.targets.length, 1)
      assert.deepEqual(d.targets[0], {
        positions: new Float32Array(),
        normals: new Float32Array(),
      })
    }
  }
})
