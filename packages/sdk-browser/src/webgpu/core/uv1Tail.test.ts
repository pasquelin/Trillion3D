// A geometry's second UV set read as floats rides at the tail of the normal atlas it is read
// through (`uv1Tail.ts`), vertex k at float T − 2(k + 1): the float pool writes it there for a
// geometry that has one — at the open and again at a growth, the atlas made at its new size —, and
// a pool opened without any refuses a geometry that brings one, as it refuses colours.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createFloatAtlas } from './floatAtlas.ts'
import { uv1TailAt, writeUv1Tail } from './uv1Tail.ts'
import { createVertexPool } from './geometryPool.ts'
import type { HostAttributes } from '../../host/resources.ts'
import { ensureBlendNormalAtlas } from '../blend/buffers.ts'
import type { WebgpuGpuState } from '../pages/state/gpu.ts'

/** The floats of an atlas of `texels` after the device's texel writes, one row. */
function replay(writes: ReturnType<typeof fakeDevice>['texelWrites'], texels: number) {
  const floats = new Float32Array(texels)
  for (const { destination, data, layout, size } of writes) {
    const [x] = destination.origin as number[],
      [width] = size as number[]
    const source = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
    floats.set(source.subarray((layout.offset ?? 0) / 4, (layout.offset ?? 0) / 4 + width), x)
  }
  return floats
}

test('vertex k of the tail is at float T − 2(k + 1), the pairs kept whole', () => {
  const { device, texelWrites } = fakeDevice()
  const atlas = createFloatAtlas(device, 'proof', 20)
  assert.equal(uv1TailAt(atlas, 3, 2), 10)
  writeUv1Tail(device.queue, atlas, 3, Float32Array.of(1, 2, 3, 4), 2)
  const floats = replay(texelWrites, 20)
  assert.deepEqual([...floats.subarray(20 - 2 * 4, 20 - 2 * 3)], [1, 2], 'vertex 3')
  assert.deepEqual([...floats.subarray(20 - 2 * 5, 20 - 2 * 4)], [3, 4], 'vertex 4')
})

/** A triangle with a second UV set. */
function secondSet() {
  const attributes = G.triangleAttributes() as HostAttributes & Record<string, unknown>
  const geometry = new G.Geometry()
  for (const [name, list] of Object.entries(attributes)) geometry.setAttribute(name, list as never)
  geometry.setAttribute('uv1', G.floatAttribute([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 2))
  return geometry.attributes as HostAttributes
}

/** The texels of the last atlas the device made. */
function lastAtlasTexels(textures: ReturnType<typeof fakeDevice>['textures']) {
  const atlas = textures.at(-1)!
  return atlas.width * atlas.height * atlas.depthOrArrayLayers
}

/** `secondSet`'s pairs at the tail of an atlas of `texels`, vertex k at float T − 2(k + 1). */
function assertSecondSetAtTail(
  writes: ReturnType<typeof fakeDevice>['texelWrites'],
  texels: number,
) {
  const floats = replay(writes, texels)
  for (let k = 0; k < 3; k++)
    assert.deepEqual(
      [...floats.subarray(texels - 2 * (k + 1), texels - 2 * k)].map((v) => Math.round(v * 10)),
      [2 * k + 1, 2 * k + 2],
      `vertex ${k}`,
    )
}

test('the pool writes a second UV set at its atlas tail, and refuses one it was opened without', () => {
  const { device, texelWrites, textures } = fakeDevice()
  const attributes = secondSet()
  const blocks = new Map()
  const pool = createVertexPool(device, 3, false, blocks, 0, undefined, true)
  pool.pack(new Map([[attributes, false]]))
  assert.equal(blocks.get(attributes).hasUv1, true)
  const texels = lastAtlasTexels(textures)
  assert.ok(texels >= 3 * 9, 'the atlas holds the normals and the tail')
  assertSecondSetAtTail(texelWrites, texels)
  const without = createVertexPool(device, 3, false, new Map(), 0, undefined, false)
  assert.equal(without.place(attributes), undefined, 'a pool without a second set refuses one')
})

test("a transparent's own atlas is written once, its second set at the tail", () => {
  const { device, texelWrites, textures } = fakeDevice()
  const attributes = secondSet()
  const gpu = { blendNormalBuffers: new Map(), vertexBytes: 0 } as unknown as WebgpuGpuState
  ensureBlendNormalAtlas(device, attributes, gpu)
  const texels = lastAtlasTexels(textures)
  assert.equal(texelWrites.length, 1, 'one write, in the atlas order')
  assertSecondSetAtTail(texelWrites, texels)
})
