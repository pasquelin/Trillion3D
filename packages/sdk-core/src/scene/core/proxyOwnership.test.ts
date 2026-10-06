import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeSceneProxy } from './proxy.ts'
import { ownedProxy } from './proxy.fixture.ts'
import {
  SCENE_PROXY_HEADER_WORDS,
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
} from '../../contracts/proxy.ts'

/** The owned proxy's file; a second triangle of its group shifts the doubles off eight bytes. */
function encoded(unaligned = false) {
  const proxy = ownedProxy()
  const data = proxy.data
  if (unaligned) {
    proxy.triangles = 2
    data.triangles = new Float32Array([...data.triangles, ...data.triangles])
    data.albedo = new Uint32Array([...data.albedo, ...data.albedo])
    data.triangleGroups = new Uint32Array([0, 0])
  }
  const columns = [
    data.triangles,
    data.albedo,
    data.nodeBounds,
    data.nodeChildren,
    data.triangleGroups,
    data.groupOffsets,
    data.owners,
    data.sourceParents,
    data.sourceMeshes,
  ]
  const header = SCENE_PROXY_HEADER_WORDS * 4
  const prefix = header + columns.reduce((sum, c) => sum + c.byteLength, 0)
  const buffer = new ArrayBuffer(prefix + data.bindWorlds.byteLength)
  new Uint32Array(buffer, 0, SCENE_PROXY_HEADER_WORDS).set([
    SCENE_PROXY_MAGIC,
    SCENE_PROXY_VERSION,
    proxy.triangles,
    1,
    1,
    2,
    3,
    0,
  ])
  let offset = header
  for (const column of columns) {
    new Uint8Array(buffer, offset, column.byteLength).set(
      new Uint8Array(column.buffer, column.byteOffset, column.byteLength),
    )
    offset += column.byteLength
  }
  const view = new DataView(buffer)
  for (let i = 0; i < data.bindWorlds.length; i++)
    view.setFloat64(prefix + i * 8, data.bindWorlds[i], true)
  proxy.bytes = buffer.byteLength
  return { proxy, buffer, prefix }
}

test('versioned proxy ownership decodes unaligned doubles without changing canonical geometry', () => {
  const { proxy, buffer, prefix } = encoded(true)
  assert.equal(prefix % 8, 4)
  const result = decodeSceneProxy(proxy, buffer)
  assert.deepEqual(result.data.bindWorlds, proxy.data.bindWorlds)
  assert.deepEqual(result.data.owners, proxy.data.owners)
  assert.deepEqual(result.data.triangles, proxy.data.triangles)
  assert.deepEqual(result.data.sourceMeshes, proxy.data.sourceMeshes)
  assert.equal(result.data.triangles.buffer, buffer, 'immutable geometry remains a cache view')
})

test('invalid provenance groups, source ranks, cycles, source meshes and nonfinite bind matrices are refused', () => {
  const check = (modify: (view: DataView, prefix: number) => void) => {
    const { proxy, buffer, prefix } = encoded()
    modify(new DataView(buffer), prefix)
    assert.throws(() => decodeSceneProxy(proxy, buffer), /Invalid proxy ownership/)
  }
  check((view) => view.setUint32(156, 1, true)) // triangle group: only group zero exists
  check((view) => view.setUint32(164, 0, true)) // empty group instead of two owners
  check((view) => view.setUint32(168, 3, true)) // only source nodes zero to two exist
  check((view) => view.setInt32(184, 0, true)) // node zero parents itself
  check((view) => view.setInt32(196, -2, true)) // a mesh rank is -1 (none) or more
  check((view, prefix) => view.setFloat64(prefix, NaN, true))
})

test('old proxy versions and truncated ownership suffixes never reach a ray', () => {
  const { proxy, buffer } = encoded()
  assert.throws(
    () => decodeSceneProxy({ ...proxy, version: 2 }, buffer),
    /Expected scene proxy version/,
  )
  assert.throws(() => decodeSceneProxy(proxy, buffer.slice(0, -4)), /length/)
})
