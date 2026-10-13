// The run-time proxy's buffer holds no instance, no placement's world and no tree: the trace reads them
// in the culling's record tables (`worldTable.ts`, the instances a field of each placement's record;
// `treeTable.ts`), so the buffer grows with the meshes alone and a world past one storage binding
// keeps its proxy. Over the device double.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { createProxyInstances } from './proxyInstances.ts'
import { createRecordTexture } from '../core/recordTexture.ts'
import { WORLD_TABLE } from './worldTable.ts'
import type { PackedDag } from './types.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { LIMITS, cut, region, surface, writes } from './proxyInstances.fixture.ts'

/** The proxy over `packed` on `device`, its instances in records of the culling's laid for it. */
const proxyOn = (device: GPUDevice, packed: PackedDag) => {
  const usage =
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
  const worlds = createRecordTexture(device, WORLD_TABLE, Math.max(1, packed.worldCount), usage)
  return createProxyInstances({ device, packed, frames: { worlds } })
}

/** The proxy of `side`² placements, each wearing one cut, over a device of `limits`. */
function proxyOver(limits: typeof LIMITS, side = 4) {
  installGpuGlobals()
  const roots = placementField(side, 3),
    worn = { primitive: { runtimeProxy: cut(2, 1, 1) }, surface: surface(1) }
  roots.forEach((root) => (root.proxy = worn))
  const packed = packDagSelection(roots)
  const gpu = fakeDevice({ limits })
  const proxies = proxyOn(gpu.device, packed)
  return { gpu, packed, proxies }
}

test('a world past one storage binding holds its proxy: the worlds are read in their table, never in it', () => {
  // A binding of eight placements' 112 bytes of records: the sixteen of the field lie past it.
  const binding = 8 * 112
  const { gpu, proxies } = proxyOver({
    ...LIMITS,
    maxBufferSize: 1 << 20,
    maxStorageBufferBindingSize: binding,
  })
  assert.ok(proxies.buffer(), 'the proxy is made')
  assert.ok(writes(gpu).length > 0, 'its header and surfaces are sent')
  // A placement past the binding written writes nothing into it: no world lies there.
  const sent = writes(gpu).length
  proxies.worldWritten(12)
  assert.equal(writes(gpu).length, sent, 'no world is sent')
  assert.equal(
    region(gpu, 'copyWorldsWord'),
    0,
    'the copies’ worlds first: no instance, no placement’s world, no exact translation',
  )
  proxies.dispose()
})

test('the proxy’s buffer holds no instance: it grows with the meshes, never with the placements', () => {
  // Sixteen placements and four thousand, each wearing the one cut.
  const few = proxyOver(LIMITS, 4).proxies,
    many = proxyOver(LIMITS, 64).proxies
  assert.equal(many.buffer()!.size, few.buffer()!.size, 'the same buffer')
  assert.equal(many.bytes, many.buffer()!.size, 'the instances lie in the culling’s records')
  few.dispose()
  many.dispose()
})

test('the proxy holds no tree: its rays walk the culling’s tree where it lies', () => {
  // Ten by ten: past one group of placements, so the field packs a tree.
  const { proxies, packed } = proxyOver(LIMITS, 10)
  assert.ok(packed.placementTree, 'the field packs a placement tree')
  installGpuGlobals()
  const flat = proxyOn(fakeDevice({ limits: LIMITS }).device, {
    ...packed,
    placementTree: undefined,
  })
  assert.equal(proxies.bytes, flat.bytes, 'not one word more than the same proxy without a tree')
  proxies.dispose()
  flat.dispose()
})
