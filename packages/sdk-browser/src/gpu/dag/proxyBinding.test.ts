// The run-time proxy is one storage binding or none: a world the culling splits in ranges holds a proxy past
// that binding, refused by name and never made; a world of one range holds every placement's row. Its tree's
// member order goes up once, and again when roots join it. Over the device double.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { cameraFrameRanges, WORLD_ROW_BYTES } from './cameraRanges.ts'
import { createProxyInstances } from './proxyInstances.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { LIMITS, cut, region, surface, writes } from './proxyInstances.fixture.ts'
import {
  INSTANCE_WORDS,
  RUNTIME_HEADER_WORDS,
  RUNTIME_ORIGIN_WORDS,
  RUNTIME_WORLD_WORDS,
} from '../../bounce/runtimeLayout.ts'

/** The proxy of `side`² placements, each wearing one cut, over a device of `limits`, its world table
 *  laid in the ranges the culling lays it in there. */
function proxyOver(limits: typeof LIMITS, side = 4) {
  installGpuGlobals()
  const roots = placementField(side, 3),
    worn = { primitive: { runtimeProxy: cut(2, 1, 1) }, surface: surface(1) }
  roots.forEach((root) => (root.proxy = worn))
  const packed = packDagSelection(roots)
  const gpu = fakeDevice({ limits })
  const table = (bytes: number) => ({
    buffers: [
      gpu.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      }),
    ],
    bytes,
  })
  const ranges = cameraFrameRanges(limits, Math.max(1, packed.worldCount))
  const frames = {
    ranges,
    worldBuffers: ranges.map(({ count }) =>
      gpu.device.createBuffer({
        size: count * WORLD_ROW_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      }),
    ),
  }
  const proxies = createProxyInstances({
    device: gpu.device,
    packed,
    nodeParts: table(packed.nodes.byteLength),
    coldParts: table(packed.pageCones.byteLength),
    frames,
  })
  return { gpu, packed, ranges, proxies }
}

test('a proxy holds more bytes a placement than the culling’s world row: past one range, past one binding', () => {
  const proxyRow = (INSTANCE_WORDS + RUNTIME_WORLD_WORDS + RUNTIME_ORIGIN_WORDS) * 4
  assert.ok(proxyRow > WORLD_ROW_BYTES, `${proxyRow} bytes against ${WORLD_ROW_BYTES}`)
})

test('a world split in two ranges: the proxy past one binding is refused by name, and none is made', () => {
  // Eight placements a range: the sixteen of the field lie in two.
  const binding = 8 * WORLD_ROW_BYTES
  const { gpu, ranges, proxies } = proxyOver({
    ...LIMITS,
    maxBufferSize: 1 << 20,
    maxStorageBufferBindingSize: binding,
  })
  assert.equal(ranges.length, 2, 'the culling splits its worlds')
  assert.equal(proxies.buffer(), undefined, 'no buffer past the binding a ray reads it through')
  assert.match(proxies.refusal ?? '', new RegExp(`past one storage binding of ${binding}`))
  assert.equal(writes(gpu).length, 0, 'nothing is sent')
  // A placement written in the second range sends nothing either: the trace reads its stand-ins.
  proxies.worldWritten(12)
  proxies.mirror({} as GPUCommandEncoder, 1)
  assert.equal(writes(gpu).length, 0)
  proxies.dispose()
})

test('a world of one range: every placement’s row, the last included, is in the buffer the trace reads', () => {
  const { gpu, ranges, proxies } = proxyOver(LIMITS)
  assert.equal(ranges.length, 1)
  assert.ok(proxies.buffer(), 'the proxy is made')
  assert.equal(proxies.refusal, undefined)
  assert.equal(region(gpu, 'instances'), ranges[0].count, 'its instances are the range’s rows')
  // The mirror copies every row, the sixteenth among them, from the one range.
  const worldsAt = (RUNTIME_HEADER_WORDS + region(gpu, 'worldsWord')) * 4
  const copied: number[] = []
  const encoder = {
    copyBufferToBuffer: (_a: unknown, _b: number, _c: unknown, at: number, size: number) => {
      if (at === worldsAt) copied.push(size)
    },
  } as unknown as GPUCommandEncoder
  proxies.mirror(encoder, 1)
  assert.deepEqual(copied, [ranges[0].count * RUNTIME_WORLD_WORDS * 4])
  proxies.dispose()
})

test('the tree’s nodes go up when the refit moved them, its member order once and again when roots join', () => {
  // Ten by ten: past one group of placements, so the field packs a tree.
  const { gpu, proxies, packed } = proxyOver(LIMITS, 10)
  assert.ok(packed.placementTree, 'the field packs a placement tree')
  const at = (name: 'treeWord' | 'membersWord') => (RUNTIME_HEADER_WORDS + region(gpu, name)) * 4
  const mirror = (revision: number) => {
    const into: string[] = []
    const encoder = {
      copyBufferToBuffer: (_a: unknown, _b: number, _c: unknown, to: number) => {
        if (to === at('treeWord')) into.push('nodes')
        if (to === at('membersWord')) into.push('members')
      },
    } as unknown as GPUCommandEncoder
    proxies.mirror(encoder, revision)
    return into
  }
  assert.deepEqual(mirror(1), ['nodes', 'members'], 'a buffer new made takes both')
  assert.deepEqual(mirror(1), [], 'a still tree copies nothing')
  assert.deepEqual(mirror(2), ['nodes'], 'a refit moves nodes, never the order')
  proxies.appended(0, 1)
  assert.deepEqual(
    mirror(2),
    ['nodes', 'members'],
    'roots joined: the nodes and the order they joined',
  )
  proxies.dispose()
})
