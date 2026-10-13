// The run-time proxy is one storage binding or none, and holds no placement's world: the trace reads them in
// the culling's record table (`worldTable.ts`), so a world the culling splits in ranges keeps its proxy. Its
// tree's member order goes up once, and again when roots join it. Over the device double.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { cameraFrameRanges, PRIMITIVE_BYTES } from './cameraRanges.ts'
import { createProxyInstances } from './proxyInstances.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { LIMITS, cut, region, surface, writes } from './proxyInstances.fixture.ts'
import { INSTANCE_WORDS, RUNTIME_HEADER_WORDS } from '../../bounce/runtimeLayout.ts'

/** The proxy of `side`² placements, each wearing one cut, over a device of `limits`, and the ranges the
 *  culling lays its frames in there. */
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
  const proxies = createProxyInstances({
    device: gpu.device,
    packed,
    nodeParts: table(packed.nodes.byteLength),
    coldParts: table(packed.pageCones.byteLength),
  })
  return { gpu, packed, ranges, proxies }
}

test('a world the culling splits in ranges holds its proxy: the worlds are read in their table, never in it', () => {
  // Eight placements a range of the frames: the sixteen of the field lie in two.
  const binding = 8 * PRIMITIVE_BYTES
  const { gpu, ranges, proxies } = proxyOver({
    ...LIMITS,
    maxBufferSize: 1 << 20,
    maxStorageBufferBindingSize: binding,
  })
  assert.equal(ranges.length, 2, 'the culling splits its frames')
  assert.ok(proxies.buffer(), 'the proxy is made')
  assert.equal(proxies.refusal, undefined)
  assert.ok(writes(gpu).length > 0, 'its instances are sent')
  // A placement written in the second range copies nothing into it: no world lies there.
  proxies.worldWritten(12)
  const copies: number[] = []
  const encoder = {
    copyBufferToBuffer: (_a: unknown, _b: number, _c: unknown, _at: number, size: number) =>
      void copies.push(size),
  } as unknown as GPUCommandEncoder
  proxies.mirror(encoder, 1)
  assert.deepEqual(copies, [], 'sixteen placements pack no tree, and no world is copied')
  assert.equal(
    region(gpu, 'copyWorldsWord'),
    16 * INSTANCE_WORDS,
    'behind the instances, the copies’ worlds: no placement’s world, no exact translation',
  )
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
