import test from 'node:test'
import assert from 'node:assert/strict'
import { Geometry } from './geometry.ts'
import { BufferAttribute, pendingAttribute } from '../buffer/attribute.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'

const points = (values: number[]) => new BufferAttribute(new Float32Array(values), 3)
const positionsOf = (g: Geometry) => Array.from(g.getAttribute('position')!.array)

test('a new geometry is unnamed, names its class, and its range covers whatever index it gets', () => {
  const g = new Geometry().setIndex([0, 1, 2, 2, 1, 0])
  assert.ok(!g.name)
  assert.equal(g.type, Geometry.name)
  assert.equal(g.drawRange.start, 0)
  assert.ok(g.drawRange.count >= g.index!.count)
})

test('only a change of positions forgets the bounds: groups and other lists keep them', () => {
  const g = new Geometry().setAttribute('position', points([0, 0, 0, 1, 2, 3]))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(4), 2))
  const box = g.computeBoundingBox()
  g.addGroup(0, 3)
  g.clearGroups()
  g.deleteAttribute('uv')
  assert.equal(g.boundingBox, box)
  g.deleteAttribute('position')
  assert.equal(g.boundingBox, null)
  const moved = new Geometry().setAttribute('position', points([0, 0, 0, 1, 2, 3]))
  moved.computeBoundingBox()
  moved.translate(1, 0, 0)
  assert.equal(moved.boundingBox, null, 'a transform moves the positions')
})

test('quarter turns about x and y carry each axis onto the next, and center uses all three axes', () => {
  near(
    positionsOf(new Geometry().setAttribute('position', points([0, 1, 0])).rotateX(Math.PI / 2)),
    [0, 0, 1],
    'x',
    1e-6,
  )
  near(
    positionsOf(new Geometry().setAttribute('position', points([0, 0, 1])).rotateY(Math.PI / 2)),
    [1, 0, 0],
    'y',
    1e-6,
  )
  const g = new Geometry().setAttribute('position', points([2, 4, 6, 4, 8, 10])).center()
  near(positionsOf(g), [-1, -2, -2, 1, 2, 2], 'centred')
})

test('smooth normals follow the index: a vertex two faces share leans between them', () => {
  // A floor facing +z and a wall facing -y, of one area, meeting along the x axis through 0 and 1.
  const g = new Geometry().setAttribute('position', points([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, -1]))
  g.setIndex([0, 1, 2, 1, 0, 3]).computeVertexNormals()
  const shared = Array.from(g.getAttribute('normal')!.array).slice(0, 3)
  near(shared, [0, -Math.SQRT1_2, Math.SQRT1_2], 'between floor and wall', 1e-6)
})

test('a geometry with no index made unindexed keeps its groups and bounds, as a clone would', () => {
  const g = new Geometry().setAttribute('position', points([0, 0, 0, 1, 0, 0, 0, 1, 0]))
  g.addGroup(0, 3, 1)
  g.computeBoundingBox()
  const copy = g.toNonIndexed()
  assert.deepEqual(copy.groups, g.groups)
  assert.deepEqual(copy.boundingBox, g.boundingBox)
})

test('loadVertices reads every deferred list: index, attributes and morph targets, then gives the geometry', async () => {
  const read: string[] = []
  const deferred = (name: string, values: number[], itemSize: number) =>
    pendingAttribute(
      {
        length: values.length,
        type: 'Float32Array',
        read: async () => (read.push(name), new Float32Array(values)),
      },
      itemSize,
      false,
    )
  const g = new Geometry().setAttribute('position', deferred('position', [1, 2, 3], 3))
  g.setIndex(deferred('index', [0, 0, 0], 1))
  g.morphAttributes.position = [deferred('target', [4, 5, 6], 3)]
  assert.equal(await g.loadVertices(), g)
  assert.deepEqual(read.sort(), ['index', 'position', 'target'])
  assert.deepEqual(positionsOf(g), [1, 2, 3])
  const plain = new Geometry().setAttribute('position', points([1, 2, 3]))
  assert.equal(await plain.loadVertices(), plain, 'no index, nothing deferred: at once')
})

test('dispose forgets the holders it had', () => {
  const g = new Geometry()
  g._listeners.add(() => {})
  g.dispose()
  assert.equal(g._listeners.size, 0)
})
