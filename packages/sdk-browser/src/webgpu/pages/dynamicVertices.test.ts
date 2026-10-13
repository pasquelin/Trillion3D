// A dynamic geometry's rewrite is written in place in the float vertex pool, and stales the
// shadow pages its moved vertices cover — its own — and no other caster's.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { createVertexPool } from '../core/geometryPool.ts'
import { type VertexPool } from '../core/geometryPool.ts'
import { createShadowMobility } from '../shadow/mobility.ts'
import type { HostAttributes } from '../../host/resources.ts'
import { webgpuVertexApi } from './dynamicVertices.ts'
import type { VertexRange } from '../../placement/engineSceneUpdates.ts'
import type { WebgpuPagesRuntime } from './runtime.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createFrameGateCore } from '../../frame/gateCore.ts'

/** A runtime of `pool` on `device`, drawing `roots` with `lights`. */
const runtimeOf = (
  vertexPool: VertexPool,
  device: GPUDevice,
  positionBuffers: Map<HostAttributes, unknown>,
  selectionRoots: unknown[] = [],
  lights = {},
  gate = createFrameGateCore(1),
) =>
  ({
    ...{ vis: { vertexPool }, gpu: { device, positionBuffers }, lights },
    ...{ run: { lost: false, gate } },
    // No row resident: a root holding a reach finds none to rewrite (`moveRootRows`).
    layout: { selectionRoots, rows: { rowOf: () => -1, blendRowOf: () => -1 } },
  }) as unknown as WebgpuPagesRuntime

test('a rewrite lands in its pool block alone and stales only its own shadow pages', () => {
  const { device, writes } = fakeDevice()
  const [wave, rock] = [geometry.plane(1, 1, 1, 1), geometry.plane(1, 1, 1, 1)]
  const attributes = [wave, rock].map((g) => g.attributes as unknown as HostAttributes)
  const pool = createVertexPool(device, 16, false, new Map())
  pool.place(attributes[1])
  const block = pool.place(attributes[0], true)!
  const roots = [0, 50].map((x, i) => ({
    pages: [{ attributes: attributes[i] }],
    world: new Matrix4().makeTranslation(x, 0, 0),
    reach: undefined as number | undefined,
  }))
  const mobility = createShadowMobility()
  mobility.ensure(2, 4, (rank) => roots[rank].world.elements)
  const staled: [number[], boolean][] = []
  const worldChanged = (min: number[], max: number[], moving: boolean) =>
    void staled.push([[...min, ...max], moving])
  const api = webgpuVertexApi(
    runtimeOf(pool, device, new Map(), roots, { mobility, changes: { worldChanged } }),
  )
  wave.attributes.position.setZ(1, 0.25)
  const box = Float64Array.of(0.5, -0.5, 0, 0.5, -0.5, 0.25)
  const reach = 0.25 // the vertex lies that far from where it rested (`createPageMotion`)
  writes.length = 0
  for (let frame = 0; frame < 2; frame++)
    assert.ok(
      api.updateVertices(attributes[0], [{ name: 'position', from: 1, count: 1 }], box, reach),
    )
  assert.equal(block.vertexBase, 4, 'placed after the rock')
  assert.deepEqual(
    [writes[0].offset, [...writes[0].data]],
    [(4 + 1) * 12, [0.5, -0.5, 0.25]],
    'one vertex written',
  )
  assert.deepEqual(
    staled,
    [
      [[0.5, -0.5, 0, 0.5, -0.5, 0.25], false],
      [[0.5, -0.5, 0, 0.5, -0.5, 0.25], true],
    ],
    'its moved box alone: whole on the first rewrite, its moving casters after',
  )
  assert.deepEqual([mobility.moves(0), mobility.moves(1)], [true, false], 'the rock stays static')
  const reaches = roots.map((root) => root.reach)
  assert.deepEqual(reaches, [reach, undefined], 'the reach is its own too')
})

test('content mounted after the open grows the pool in place: it is drawn, never reopened', () => {
  const { device, copies } = fakeDevice()
  const pool = createVertexPool(device, 8, false, new Map())
  const sheet = () => geometry.plane(1, 1, 1, 1).attributes as unknown as HostAttributes
  assert.ok(pool.place(sheet(), true), 'the first block')
  assert.ok(pool.place(sheet(), true), 'a mount after the open, in the room kept')
  const api = webgpuVertexApi(runtimeOf(pool, device, new Map()))
  const box = new Float64Array(6),
    range: VertexRange[] = [{ name: 'position', from: 0, count: 1 }]
  assert.ok(api.updateVertices(sheet(), range, box, 0), 'grown in place, not refused')
  assert.ok(copies.length > 0, 'what the pool held copied into the wider buffers')
})

test('a block a rewritten mesh holds survives a growth: written at the same place, no reopen', () => {
  const { device, writes, copies } = fakeDevice()
  const held = geometry.plane(1, 1, 2, 2).attributes as unknown as HostAttributes
  const pool = createVertexPool(device, 9, false, new Map())
  const api = webgpuVertexApi(runtimeOf(pool, device, new Map()))
  const box = new Float64Array(6),
    range: VertexRange[] = [{ name: 'position', from: 1, count: 1 }]
  assert.ok(api.updateVertices(held, range, box, 0), 'the dynamic mesh placed and written')
  const before = writes.at(-1)!
  // A record mounted after the open, past the room kept: the pool grows in place.
  const mounted = geometry.plane(1, 1, 2, 2).attributes as unknown as HostAttributes
  assert.ok(api.updateVertices(mounted, range, box, 0), 'the mount grown in place')
  assert.ok(api.updateVertices(held, range, box, 0), 'the held mesh written again, not reopened')
  const after = writes.at(-1)!
  assert.equal(after.offset, before.offset, 'the same block offset: the held box survived')
  assert.notEqual(after.buffer, before.buffer, 'into the wider buffer the growth made')
  assert.ok(copies.length > 0, 'the held vertices copied into it')
})

test('a rewrite weighs what it sends the GPU: a normal with its tangent, positions twice', () => {
  const { device, writes, textureWrites } = fakeDevice()
  const plane = geometry.plane(1, 1, 1, 1).attributes // its doubles: the world hands floats
  const xyz = new BufferAttribute(Float32Array.from(plane.position.array), 3)
  const attributes = { ...plane, position: xyz } as unknown as HostAttributes
  const pool = createVertexPool(device, 8, false, new Map())
  pool.place(attributes, true)
  const api = webgpuVertexApi(runtimeOf(pool, device, new Map([[attributes, {}]])))
  const position = { name: 'position', from: 1, count: 2 } as const
  const ranges: VertexRange[] = [position, { name: 'normal', from: 0, count: 1 }]
  const weighed = api.vertexBytes(attributes, ranges)
  writes.length = textureWrites.length = 0
  assert.ok(api.updateVertices(attributes, ranges, new Float64Array(6), 0))
  // The buffers' bytes, and the float atlas's: one float a texel (`r32float`).
  const sent =
    writes.reduce((bytes, { data }) => bytes + data.byteLength, 0) +
    textureWrites.reduce(
      (bytes, { size }) => bytes + 4 * [...(size as number[])].reduce((a, b) => a * b),
      0,
    )
  assert.equal(weighed, sent, 'what is weighed is what is sent')
  assert.equal(weighed, 2 * 12 * 2 + 7 * 4, 'two positions twice, one normal and its tangent')
})

test('a rewrite breaks the held image but moves no pose: the next image walks no world', () => {
  const { device } = fakeDevice()
  const attributes = geometry.plane(1, 1, 1, 1).attributes as unknown as HostAttributes
  const pool = createVertexPool(device, 8, false, new Map())
  pool.place(attributes, true)
  const gate = createFrameGateCore(1),
    worlds = { walks: 0, refresh: () => void worlds.walks++ }
  const api = webgpuVertexApi(runtimeOf(pool, device, new Map(), [], {}, gate))
  gate.updateWorlds(worlds as never) // the first image walks them once
  for (let frame = 0; frame < 3; frame++) {
    const scene = gate.revisions.scene
    const range = { name: 'position', from: 0, count: 1 } as const
    assert.ok(api.updateVertices(attributes, [range], new Float64Array(6), 0))
    assert.ok(gate.revisions.scene > scene, `frame ${frame}: the held image is broken`)
    assert.equal(gate.updateWorlds(worlds as never), false, `frame ${frame}: no world walked`)
  }
  assert.equal(worlds.walks, 1, 'the rows table, its occluders and corners kept')
})
