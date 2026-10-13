import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneProxyReader } from './proxyLoad.ts'
import { createPageCache } from '../streaming/pageCache.ts'
import { sha256Hex } from '../streaming/sha256Hex.ts'
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
  type SceneProxyDescriptor,
} from '../../../sdk-core/src/index.ts'

test('shared expansion is decoded once across concurrent readers and sessions, and charged to CPU memory', async (t) => {
  // One mesh of one triangle under one leaf node (`SceneProxy::encode`).
  const triangles = 1,
    nodes = 1
  const cell = new Uint32Array(Float32Array.of(0.5).buffer)[0]
  const children = new Uint32Array(PROXY_NODE_WORDS)
  children[1] = (1 << 24) | (1 << 16)
  const words = [
    ...[SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION, 1, triangles, nodes, 0, 1, 1, cell],
    ...new Uint32Array(Float32Array.from({ length: PROXY_TRIANGLE_FLOATS }, (_, k) => k).buffer),
    0xffffffff,
    ...new Uint32Array(new Float32Array(PROXY_NODE_FLOATS).buffer),
    ...children,
  ]
  const bytes = new Uint8Array(Uint32Array.from(words).buffer)
  const descriptor: SceneProxyDescriptor = {
    version: SCENE_PROXY_VERSION,
    triangles,
    nodes,
    meshes: 1,
    bytes: bytes.byteLength,
    sha256: await sha256Hex(bytes.buffer),
    url: 'proxy.bin',
    bounds: [0, 0, 0, 1, 1, 1],
    errorMetres: 0,
    errorFloorMetres: 0,
    cellMetres: 0.5,
    triangleBudget: triangles,
  }
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    return new Response(bytes.slice())
  })
  const cache = createPageCache()
  /** Bytes the cache holds of the proxy, kept under its address and fingerprint. */
  const kept = () => cache.weight(`https://example.test/proxy.bin#${descriptor.sha256}`)
  const read = createSceneProxyReader(descriptor, 'https://example.test/', cache)!
  const [first, concurrent] = await Promise.all([read(), read()])
  const reopened = createSceneProxyReader(descriptor, 'https://example.test/', cache)!
  assert.equal((await reopened()).data, first.data)
  assert.equal(concurrent.data, first.data)
  assert.equal(requests, 1)
  assert.equal(kept(), bytes.byteLength)
  assert.equal(first.data.meshes[0].triangles.byteLength, triangles * 36)
  const own = createSceneProxyReader(descriptor, 'https://example.test/', createPageCache())!
  assert.equal((await own()).data, (await own()).data)
  assert.equal(requests, 2, "one read and expansion in a session's own cache, too")
  const changed = createSceneProxyReader(
    { ...descriptor, errorMetres: 9 },
    'https://example.test/',
    cache,
  )!
  assert.equal((await changed()).errorMetres, 9, 'each reader retains its manifest metadata')
  assert.equal((await changed()).data, first.data, 'metadata changes do not expand geometry again')
  const invalid = createSceneProxyReader(
    { ...descriptor, triangles: triangles + 1 },
    'https://example.test/',
    cache,
  )!
  await assert.rejects(invalid(), /disagrees with its manifest/)
  cache.keepOnly()
  assert.equal(kept(), 0)
})
