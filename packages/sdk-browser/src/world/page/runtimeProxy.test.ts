import test from 'node:test'
import assert from 'node:assert/strict'
import { sdkWasm } from '../../wasm/sdkWasm.fixture.ts'
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../../sdk-core/src/index.ts'
import { buildCutProxy } from './runtimeProxy.ts'
import { cubeGeometry } from './cube.fixture.ts'

test("the proxy of a cut is the compiler builder's columns, in the cut's own space", () => {
  const { indices, positions } = cubeGeometry()
  const proxy = buildCutProxy(sdkWasm, indices, positions)
  assert.equal(proxy.triangles.length, 12 * PROXY_TRIANGLE_FLOATS)
  assert.equal(proxy.albedo.length, 12)
  assert.ok(proxy.albedo.every((word) => word === 0xffffffff))
  assert.equal(
    proxy.nodeBounds.length / PROXY_NODE_FLOATS,
    proxy.nodeChildren.length / PROXY_NODE_WORDS,
  )
  assert.deepEqual([...proxy.nodeBounds.slice(0, 6)], [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5])
  assert.ok(proxy.cellMetres > 0 && proxy.cellMetres < 0.01)
})

test('two builds of one cut are the same bytes', () => {
  const { indices, positions } = cubeGeometry()
  const a = buildCutProxy(sdkWasm, indices, positions)
  const b = buildCutProxy(sdkWasm, indices, positions)
  assert.deepEqual(a, b)
})
