// The proxy file: one proxy a compiled mesh in its own space comes back column by column, and a file whose
// header, table or links disagree with what it holds is refused before any ray reads it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROXY_CHILD_WORDS,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
  SCENE_PROXY_HEADER_WORDS,
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
  type SceneProxyDescriptor,
} from '../../contracts/proxy.ts'
import { decodeSceneProxy } from './proxy.ts'

/** A mesh of `triangles` triangles under one node that holds them all in one leaf. */
function mesh(triangles: number, seed: number) {
  const nodeChildren = new Uint32Array(triangles ? PROXY_NODE_WORDS : 0)
  if (triangles) {
    // The first child present, a leaf of all the triangles from the first.
    nodeChildren[1] = (1 << 24) | (triangles << 16)
    nodeChildren[2] = 0
  }
  return {
    triangles: Float32Array.from({ length: triangles * PROXY_TRIANGLE_FLOATS }, (_, k) => seed + k),
    albedo: Uint32Array.from({ length: triangles }, (_, k) => 0xff000000 + seed + k),
    nodeBounds: Float32Array.from(
      { length: triangles ? PROXY_NODE_FLOATS : 0 },
      (_, k) => seed - k,
    ),
    nodeChildren,
    cell: 0.25 * (seed + 1),
  }
}

/** The bytes the compiler writes for `meshes` (`SceneProxy::encode`), and the descriptor naming them. */
function file(meshes: ReturnType<typeof mesh>[]) {
  const triangles = meshes.reduce((sum, m) => sum + m.triangles.length / PROXY_TRIANGLE_FLOATS, 0),
    nodes = meshes.reduce((sum, m) => sum + m.nodeChildren.length / PROXY_NODE_WORDS, 0)
  const words = [SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION, meshes.length, triangles, nodes, 0]
  const table = new Float32Array(1)
  for (const m of meshes) {
    table[0] = m.cell
    words.push(
      m.triangles.length / PROXY_TRIANGLE_FLOATS,
      m.nodeChildren.length / PROXY_NODE_WORDS,
      new Uint32Array(table.buffer)[0],
    )
  }
  const bits = (column: Float32Array | Uint32Array) =>
    Array.from(new Uint32Array(column.buffer, column.byteOffset, column.length))
  for (const m of meshes) words.push(...bits(m.triangles))
  for (const m of meshes) words.push(...bits(m.albedo))
  for (const m of meshes) words.push(...bits(m.nodeBounds))
  for (const m of meshes) words.push(...bits(m.nodeChildren))
  const buffer = Uint32Array.from(words).buffer
  const descriptor: SceneProxyDescriptor = {
    ...{ version: SCENE_PROXY_VERSION, url: 'proxy.bin', sha256: 'x', bytes: buffer.byteLength },
    ...{ errorMetres: 0, errorFloorMetres: 0, cellMetres: 1, triangleBudget: 1 },
    ...{ triangles, nodes, meshes: meshes.length, bounds: [0, 0, 0, 1, 1, 1] },
  }
  return { buffer, descriptor }
}

test('each mesh comes back with its own triangles, albedo, nodes and grid step', () => {
  const meshes = [mesh(3, 1), mesh(0, 0), mesh(2, 5)]
  const { buffer, descriptor } = file(meshes)
  const { data } = decodeSceneProxy(descriptor, buffer)
  assert.equal(data.meshes.length, 3)
  meshes.forEach((want, k) => {
    const got = data.meshes[k]
    assert.deepEqual(Array.from(got.triangles), Array.from(want.triangles))
    assert.deepEqual(Array.from(got.albedo), Array.from(want.albedo))
    assert.deepEqual(Array.from(got.nodeBounds), Array.from(want.nodeBounds))
    assert.deepEqual(Array.from(got.nodeChildren), Array.from(want.nodeChildren))
    assert.equal(got.cellMetres, want.cell)
  })
})

test('a file whose header, signature or length disagrees with the manifest is refused', () => {
  const { buffer, descriptor } = file([mesh(2, 1)])
  assert.throws(() => decodeSceneProxy({ ...descriptor, triangles: 3 }, buffer), /disagrees/)
  assert.throws(() => decodeSceneProxy({ ...descriptor, meshes: 2 }, buffer), /disagrees/)
  assert.throws(() => decodeSceneProxy({ ...descriptor, bytes: 8 }, buffer), /length/)
  const signed = buffer.slice(0)
  new Uint32Array(signed)[0] = 0
  assert.throws(() => decodeSceneProxy(descriptor, signed), /WGPX/)
  assert.throws(
    () => decodeSceneProxy({ ...descriptor, version: SCENE_PROXY_VERSION - 1 }, buffer),
    /version/,
  )
})

test('a leaf that names triangles its mesh lacks, or a node that does not point forward, is refused', () => {
  const lacking = mesh(2, 1)
  lacking.nodeChildren[1] = (1 << 24) | (3 << 16)
  assert.throws(
    () => decodeSceneProxy(file([lacking]).descriptor, file([lacking]).buffer),
    /triangles it does not have/,
  )
  const looping = mesh(2, 1)
  looping.nodeChildren[1] = 1 << 24
  looping.nodeChildren[2] = 0
  assert.throws(
    () => decodeSceneProxy(file([looping]).descriptor, file([looping]).buffer),
    /forward/,
  )
})

test('a child holds three words, the link the third, and the header six', () => {
  assert.equal(PROXY_CHILD_WORDS, 3)
  assert.equal(SCENE_PROXY_HEADER_WORDS, 6)
})
