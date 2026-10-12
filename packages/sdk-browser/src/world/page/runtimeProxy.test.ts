import test from 'node:test'
import assert from 'node:assert/strict'
import { sdkWasm } from '../../wasm/sdkWasm.fixture.ts'
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../../sdk-core/src/index.ts'
import { buildCutProxy } from './runtimeProxy.ts'

/** A unit cube: eight vertices, twelve triangles. */
function cube() {
  const positions = new Float32Array(24)
  for (let v = 0; v < 8; v++) positions.set([v & 1, (v >> 1) & 1, (v >> 2) & 1], v * 3)
  const indices = Uint32Array.of(
    0,
    2,
    1,
    1,
    2,
    3,
    4,
    5,
    6,
    5,
    7,
    6,
    0,
    1,
    4,
    1,
    5,
    4,
    2,
    6,
    3,
    3,
    6,
    7,
    0,
    4,
    2,
    2,
    4,
    6,
    1,
    3,
    5,
    3,
    7,
    5,
  )
  return { indices, positions }
}

test("the proxy of a cut is the compiler builder's columns, in the cut's own space", () => {
  const { indices, positions } = cube()
  const proxy = buildCutProxy(sdkWasm, indices, positions)
  assert.equal(proxy.triangles.length, 12 * PROXY_TRIANGLE_FLOATS)
  assert.equal(proxy.albedo.length, 12)
  assert.ok(proxy.albedo.every((word) => word === 0xffffffff))
  assert.equal(
    proxy.nodeBounds.length / PROXY_NODE_FLOATS,
    proxy.nodeChildren.length / PROXY_NODE_WORDS,
  )
  assert.deepEqual([...proxy.nodeBounds.slice(0, 6)], [0, 0, 0, 1, 1, 1])
  assert.ok(proxy.cellMetres > 0 && proxy.cellMetres < 0.01)
})

test('two builds of one cut are the same bytes', () => {
  const { indices, positions } = cube()
  const a = buildCutProxy(sdkWasm, indices, positions)
  const b = buildCutProxy(sdkWasm, indices, positions)
  assert.deepEqual(a, b)
})
