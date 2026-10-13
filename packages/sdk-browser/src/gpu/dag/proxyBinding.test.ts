// The run-time proxy is one storage binding or none, and holds no placement's world and no tree: the trace
// reads them in the culling's record tables (`worldTable.ts`, `treeTable.ts`), so a world the culling splits
// in ranges keeps its proxy. Over the device double.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { cameraFrameRanges, PRIMITIVE_BYTES } from './cameraRanges.ts'
import { createProxyInstances } from './proxyInstances.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { LIMITS, cut, region, surface, writes } from './proxyInstances.fixture.ts'
import { INSTANCE_WORDS } from '../../bounce/runtimeLayout.ts'

/** The proxy of `side`² placements, each wearing one cut, over a device of `limits`, and the ranges the
 *  culling lays its frames in there. */
function proxyOver(limits: typeof LIMITS, side = 4) {
  installGpuGlobals()
  const roots = placementField(side, 3),
    worn = { primitive: { runtimeProxy: cut(2, 1, 1) }, surface: surface(1) }
  roots.forEach((root) => (root.proxy = worn))
  const packed = packDagSelection(roots)
  const gpu = fakeDevice({ limits })
  const ranges = cameraFrameRanges(limits, Math.max(1, packed.worldCount))
  const proxies = createProxyInstances({ device: gpu.device, packed })
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
  // A placement written in the second range writes nothing into it: no world lies there.
  const sent = writes(gpu).length
  proxies.worldWritten(12)
  assert.equal(writes(gpu).length, sent, 'no world is sent')
  assert.equal(
    region(gpu, 'copyWorldsWord'),
    16 * INSTANCE_WORDS,
    'behind the instances, the copies’ worlds: no placement’s world, no exact translation',
  )
  proxies.dispose()
})

test('the proxy holds no tree: its rays walk the culling’s tree where it lies', () => {
  // Ten by ten: past one group of placements, so the field packs a tree.
  const { proxies, packed } = proxyOver(LIMITS, 10)
  assert.ok(packed.placementTree, 'the field packs a placement tree')
  installGpuGlobals()
  const flat = createProxyInstances({
    device: fakeDevice({ limits: LIMITS }).device,
    packed: { ...packed, placementTree: undefined },
  })
  assert.equal(proxies.bytes, flat.bytes, 'not one word more than the same proxy without a tree')
  proxies.dispose()
  flat.dispose()
})
