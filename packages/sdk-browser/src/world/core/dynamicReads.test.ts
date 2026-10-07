// A geometry rewritten every frame is read whole each frame, by the one bulk read of an
// attribute (`VertexElements.readInto`): a list whose stored numbers are the ones read is copied
// whole, any other read number by number. Each read is the number-by-number one it replaces, bit
// for bit: floats of every width, integers, a world geometry's normalised list read as stored, a
// host's read at its value, a list narrower than its read padded, an interleaved one read through
// its view — by `readList` and by the float pool alike.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { readList } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import { readComponent } from '../../../../sdk-core/src/world/geometry/bounds.ts'
import {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { fakeDevice, replayWrites } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createVertexPool } from '../../webgpu/core/geometryPool.ts'
import type { HostAttributes } from '../../host/resources.ts'

const VALUES = [0.1, -2.5e7, 3, 1 / 3, Math.PI, -0, 65535, 1e-40, 7, 255, 0.5, -1]

/** `name` of `g` read number by number, as `readList` read it before `readInto`. */
function byNumber(g: Geometry, name: string, width: number, n: number) {
  const a = g.attributes[name]!,
    out = new Float32Array(n * width)
  for (let v = 0; v < n; v++)
    for (let c = 0; c < width; c++)
      out[v * width + c] = c < a.itemSize ? readComponent(g, a, v, c) : 1
  return out
}

test('a list copied whole is the list read number by number, whatever it stores', () => {
  const lists = [
    new BufferAttribute(new Float32Array(VALUES), 3),
    new BufferAttribute(new Float64Array(VALUES), 3),
    new BufferAttribute(Int16Array.from(VALUES.map(Math.round)), 3),
    new BufferAttribute(Uint8Array.from(VALUES.map((v) => Math.abs(Math.round(v)) % 256)), 3, true),
    new BufferAttribute(new Float32Array(VALUES.slice(0, 8)), 2),
    new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(VALUES), 4), 3, 1),
  ]
  for (const owner of ['world', 'host'] as const)
    for (const [k, list] of lists.entries()) {
      const g = new Geometry()
      g._owner = owner
      g.setAttribute('normal', list)
      const width = list.itemSize === 2 ? 3 : list.itemSize
      const n = list.count
      assert.deepEqual(
        readList(g, 'normal', width, n),
        byNumber(g, 'normal', width, n),
        `${owner} ${k}`,
      )
    }
})

test('the float pool writes a list from its numbers as it did from each component', () => {
  const gpu = fakeDevice()
  const position = new BufferAttribute(new Float64Array(VALUES), 3),
    uv = new BufferAttribute(Int16Array.from(VALUES.slice(0, 8).map(Math.round)), 2),
    attributes = { position, uv } as unknown as HostAttributes
  const pool = createVertexPool(gpu.device, 8, false, new Map())
  pool.place(attributes, true)
  pool.write(attributes, 'position', 1, 2)
  const stored = (buffer: GPUBuffer) => {
    const bytes = new ArrayBuffer((buffer as unknown as { size: number }).size)
    replayWrites(
      bytes,
      gpu.writes.filter((w) => w.buffer === buffer),
    )
    return new Float32Array(bytes)
  }
  const positions = stored(pool.concatPos),
    uvs = stored(pool.concatUv)
  for (let v = 0; v < position.count; v++)
    for (let c = 0; c < 3; c++)
      assert.equal(positions[v * 3 + c], Math.fround(position.getComponent(v, c)), `${v} ${c}`)
  for (let v = 0; v < uv.count; v++)
    for (let c = 0; c < 2; c++)
      assert.equal(uvs[v * 2 + c], Math.fround(uv.getComponent(v, c)), `uv ${v} ${c}`)
})
