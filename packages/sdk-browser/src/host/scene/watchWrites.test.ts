// The watch reads the fields no pose hook hears only once the engine's write count moved: a still
// frame reads no node at all, and every write the contract lets the host make is still taken —
// numbers written straight into an array or a colour the node handed out once announced.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../graph/graph.fixture.ts'
import { createHostSceneWatch } from './watch.ts'
import type { WatchVerdict } from './scan.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

const FIELDS = ['parent', 'visible', 'castShadow', 'matrixAutoUpdate'] as const

/** Counts the reads of `node`'s fields, each still answering through its own descriptor. */
function counted(node: Object3D) {
  const reads = { n: 0 }
  for (const field of FIELDS) {
    let at: object | null = node,
      d: PropertyDescriptor | undefined
    while (at && !(d = Object.getOwnPropertyDescriptor(at, field))) at = Object.getPrototypeOf(at)
    const owner = at as Record<string, unknown>,
      found = d!
    Object.defineProperty(node, field, {
      configurable: true,
      get() {
        reads.n++
        return found.get ? found.get.call(node) : owner[field]
      },
      set(value: unknown) {
        if (found.set) found.set.call(node, value)
        else owner[field] = value
      },
    })
  }
  return reads
}

function scene() {
  const source = new G.Group()
  const mesh = G.mesh()
  const lamp = G.spotLight(0xffffff, 1, 10, 0.5, 0.2, 2)
  const sky = G.lightProbe()
  source.add(mesh, lamp, sky)
  const watch = createHostSceneWatch()
  watch.observe(source, [{ sourceMesh: mesh }])
  watch.take()
  return { source, mesh, lamp, sky, watch }
}

test('a still frame reads no watched node; a write is read once', () => {
  const { mesh, watch } = scene()
  const reads = counted(mesh)
  for (let frame = 0; frame < 3; frame++) assert.equal(watch.take(), 0)
  assert.equal(reads.n, 0, 'nothing was written: no field is read')
  mesh.visible = false
  assert.equal(watch.take(), 'moved')
  assert.equal(reads.n, FIELDS.length, 'the write is read, each field once')
  assert.equal(watch.take(), 0)
  assert.equal(reads.n, FIELDS.length, 'and not again')
})

type Scene = ReturnType<typeof scene>
const WRITES: Array<[string, (s: Scene) => void, WatchVerdict?]> = [
  ['visible', ({ mesh }) => void (mesh.visible = false)],
  ['castShadow', ({ mesh }) => void (mesh.castShadow = false)],
  ['matrixAutoUpdate', ({ mesh }) => void (mesh.matrixAutoUpdate = true)],
  ['a reparenting', ({ mesh }) => void new G.Group().add(mesh), 'reshaped'],
  ['a light intensity', ({ lamp }) => void (lamp.intensity = 7)],
  ['a light range and cone', ({ lamp }) => void ((lamp.distance = 42), (lamp.angle = 0.1))],
  ['a light colour set', ({ lamp }) => void lamp.color.setRGB(0.25, 0.5, 0.75)],
  ['a light ground colour set', ({ lamp }) => void lamp.groundColor.setRGB(0.1, 0.2, 0.3)],
  [
    'a colour channel written straight, announced',
    ({ sky }) => void ((sky.color.g = 0.9), (sky.needsUpdate = true)),
  ],
  [
    'a colour replaced, announced',
    ({ lamp }) => void (Object.assign(lamp, { color: new G.Color(0xff0000) }).needsUpdate = true),
  ],
  [
    'a frozen matrix written through the getter',
    ({ mesh }) => void mesh.matrix.makeTranslation(5, 0, 0),
  ],
]

for (const [name, write, verdict = 'moved'] of WRITES)
  test(`${name} is taken as ${verdict}, once`, () => {
    const s = scene()
    s.mesh.matrixAutoUpdate = false
    s.watch.take()
    write(s)
    assert.equal(s.watch.take(), verdict)
    assert.equal(s.watch.take(), 0, 'read again, the value is the one held')
  })

test('a frozen matrix written behind the getter is taken once announced, not before', () => {
  const { mesh, watch } = scene()
  mesh.matrixAutoUpdate = false
  const kept = mesh.matrix
  watch.take()
  kept.elements[12] = 3
  assert.equal(watch.take(), 0, 'not announced: the count stands, nothing is read')
  mesh.matrixWorldNeedsUpdate = true
  assert.equal(watch.take(), 'moved')
  assert.equal(watch.take(), 0)
})

test('storage of its own written behind the getter is taken into the tree once announced', () => {
  const { mesh, watch } = scene()
  mesh.matrixAutoUpdate = false
  const own = new Float64Array(mesh.matrix.elements)
  mesh.matrix.elements = own
  watch.take()
  own[13] = 4
  mesh.matrixWorldNeedsUpdate = true
  assert.equal(watch.take(), 'moved')
  assert.equal(G.Object3D._treeOf(mesh).localViews[mesh.index][13], 4, 'the tree holds it')
  assert.equal(watch.take(), 0)
})

test('a colour channel written straight and not announced reads nothing', () => {
  const { sky, watch } = scene()
  sky.color.g = 0.9
  assert.equal(watch.take(), 0, 'the count stands')
  sky.needsUpdate = true
  assert.equal(watch.take(), 'moved')
})
