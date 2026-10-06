import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneProxyMotion } from './proxyMotion.ts'
import { ownedProxy, proxyIdentity } from './proxy.fixture.ts'

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} != ${expected}`)

test('moving one shared owner leaves its stationary surface and other sessions intact', () => {
  const proxy = ownedProxy(),
    before = proxy.data.nodeBounds.slice(),
    geometry = proxy.data.triangles.slice()
  const motion = createSceneProxyMotion(proxy),
    other = createSceneProxyMotion(proxy)
  const identity = proxyIdentity(),
    moved = proxyIdentity()
  assert.equal(
    motion.sync(() => identity),
    null,
  )
  moved[12] = 10
  assert.equal(
    motion.sync((node) => (node === 0 ? moved : identity)),
    'moved',
  )
  close(motion.bounds[0], 0)
  close(motion.bounds[3], 11)
  assert.equal(motion.transforms[12], 10)
  assert.equal(motion.transforms[28], 0)
  assert.deepEqual(proxy.data.nodeBounds, before)
  assert.deepEqual(other.data.nodeBounds, before)
  assert.deepEqual(proxy.data.triangles, geometry, 'canonical geometry remains immutable')
  // One triangle cannot stand at two poses: owners apart keep the proxy dynamic.
  assert.equal(
    motion.sync((node) => (node === 0 ? moved : identity)),
    null,
  )
  assert.equal(motion.dynamic, true)
  assert.equal(motion.revision, 1)
  assert.ok(motion.hostBytes >= motion.transforms.byteLength + motion.data.bindWorlds.byteLength)
})

test('absent partition owners follow their mapped parent and the wrapper', () => {
  const proxy = ownedProxy()
  proxy.data.sourceParents[0] = 2
  const motion = createSceneProxyMotion(proxy),
    parent = proxyIdentity(),
    wrapper = proxyIdentity()
  parent[13] = 5
  wrapper[12] = -3
  assert.equal(
    motion.sync((node) => (node === 2 ? parent : node === -1 ? wrapper : undefined)),
    'moved',
  )
  close(motion.transforms[13], 5)
  close(motion.transforms[28], -3)
  close(motion.bounds[0], -3)
  close(motion.bounds[4], 6)
})

test('irrelevant source movement does not switch the static path or refit', () => {
  const motion = createSceneProxyMotion(ownedProxy()),
    identity = proxyIdentity(),
    camera = proxyIdentity()
  camera[12] = 100
  assert.equal(
    motion.sync((node) => (node === 2 ? camera : identity)),
    null,
  )
  assert.equal(motion.dynamic, false)
})

test('a retained singular plane follows translation and rotation without collapsing', () => {
  const proxy = ownedProxy()
  proxy.data.bindWorlds[10] = 0
  const motion = createSceneProxyMotion(proxy),
    plane = proxyIdentity(),
    identity = proxyIdentity()
  plane[10] = 0
  plane[12] = 3
  assert.equal(
    motion.sync((node) => (node === 0 ? plane : identity)),
    'moved',
  )
  close(motion.bounds[3], 4)
  // The flattened XY plane rotates to YZ, preserving its two independent local directions.
  plane[0] = 0
  plane[2] = -1
  plane[12] = 0
  assert.equal(
    motion.sync((node) => (node === 0 ? plane : identity)),
    'moved',
  )
  close(motion.bounds[2], -1)
  close(motion.bounds[4], 1)
})

test('returning a translated owner to bind restores its geometry without cumulative drift', () => {
  const motion = createSceneProxyMotion(ownedProxy()),
    world = proxyIdentity()
  world[12] = 1234
  motion.sync(() => world)
  world[12] = 0
  motion.sync(() => world)
  close(motion.bounds[0], 0)
  close(motion.bounds[3], 1)
  assert.equal(motion.transforms[12], 0)
  assert.equal(
    motion.sync(() => world),
    'settled',
    'the first still sync settles',
  )
  assert.deepEqual(motion.data.triangles, ownedProxy().data.triangles)
  assert.equal(
    motion.sync(() => world),
    null,
  )
})

test('the first sync with no motion settles owners onto the still path at their pose', () => {
  const proxy = ownedProxy(),
    motion = createSceneProxyMotion(proxy),
    world = proxyIdentity()
  world[12] = 3
  world[14] = 2
  assert.equal(
    motion.sync(() => world),
    'moved',
  )
  assert.equal(motion.dynamic, true)
  const bounds = motion.data.nodeBounds.slice()
  assert.equal(
    motion.sync(() => world),
    'settled',
    'nothing moved: the proxy settles',
  )
  assert.equal(motion.dynamic, false, 'rays read no owner word again')
  assert.deepEqual([...motion.data.triangles], [3, 0, 2, 4, 0, 2, 3, 1, 2])
  assert.deepEqual(motion.data.nodeBounds, bounds, 'the refitted tree already covers the pose')
  assert.deepEqual([...proxy.data.triangles], [0, 0, 0, 1, 0, 0, 0, 1, 0])
  assert.equal(
    motion.sync(() => world),
    null,
    'a settled proxy does nothing more',
  )
  world[12] = 5
  assert.equal(
    motion.sync(() => world),
    'moved',
  )
  assert.equal(motion.dynamic, true)
  assert.deepEqual(motion.data.triangles, proxy.data.triangles, 'motion resumes from canonical')
  close(motion.bounds[0], 5)
})
