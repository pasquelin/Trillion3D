import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { ensureWebgpuVisibilityBindings } from './bindings.ts'
import { ensureWebgpuShadeBindings } from '../core/shadeBindings.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { visGroupFor } from './visGroup.ts'
import { createPhysicalTable } from './physicalTable.ts'

/** A device that counts its groups, and a runtime holding every resource the groups name. */
function mount() {
  const { device, bindGroups } = fakeDevice()
  const views = [{}, {}, {}],
    dataViews = [{}, {}, {}],
    pages = { buffer: {} }
  const vis = {
    visBindGroupLayout: {},
    shadeBindGroupLayout: {},
    visView: {},
    concatPos: {},
    concatUv: {},
    concatNrm: { buffer: {} },
    pageTable: {},
    visUniform: {},
    shadeUniform: {},
    shadeCache: { buffer: {} },
    zeroFlags: {},
    gpuHiz: { flags: {} },
    textures: { color: { views, pages }, data: { views: dataViews, pages } },
    mapsSampler: {},
    shadeBindGroup: undefined as unknown,
    visSlotGroups: [undefined, undefined] as unknown[],
    rasterGroups: [undefined] as unknown[],
    visIdentity: createWebgpuBindIdentity(),
    shadeIdentity: createWebgpuBindIdentity(),
    physicalTable: createPhysicalTable(),
  }
  const gpu = {
    cache: { buffer: {} },
    surfaces: { subsurfaceView: {}, receiverView: {}, lobesView: {} },
  }
  const rt = { vis, gpu, run: {} } as unknown as WebgpuPagesRuntime
  const ensure = () => {
    ensureWebgpuVisibilityBindings(rt)
    ensureWebgpuShadeBindings(rt, device)
    return bindGroups.length
  }
  return { vis, gpu, rt, device, ensure }
}

test('a resized page pool voids every group that named it, by identity alone', () => {
  const { vis, gpu, ensure } = mount()
  assert.equal(ensure(), 1, "the resolve group built once: slot groups are their passes'")
  // Slot and raster groups are built by their own passes on the same resources.
  vis.visSlotGroups.fill({})
  vis.rasterGroups.fill({})
  assert.equal(ensure(), 1, 'a still image rebuilds nothing')
  assert.deepEqual(vis.visSlotGroups, [{}, {}], 'the slot groups are held with them')
  // The pool was resized: another buffer, in the same place, and no drop by name anywhere.
  gpu.cache = { buffer: {} }
  assert.equal(ensure(), 2, 'the resolve group is rebuilt')
  assert.deepEqual(vis.visSlotGroups, [undefined, undefined])
  assert.deepEqual(vis.rasterGroups, [undefined])
})

test('an atlas that changed layers voids only the groups that sample it', () => {
  const { vis, ensure } = mount()
  ensure()
  // The data atlas: sampled by the resolve, never by the visibility raster.
  vis.textures.data.views = [{}, {}, {}]
  vis.visSlotGroups.fill({})
  assert.equal(ensure(), 2, 'the resolve group alone is rebuilt')
  assert.deepEqual(vis.visSlotGroups, [{}, {}], 'the slot groups do not sample it')
  vis.textures.color.views = [{}, {}, {}]
  assert.equal(ensure(), 3, 'the colour atlas is named by the resolve')
  assert.deepEqual(vis.visSlotGroups, [undefined, undefined], 'and by the slot groups')
})

test('atlas entries alone govern table and individual lane invalidation; stable reads reuse descriptors', () => {
  const { vis, ensure } = mount()
  ensure()
  const direct = vis.visIdentity.entries[0]
  const resources = direct.map((entry) => entry.resource)
  vis.visSlotGroups.fill({})
  ensure()
  assert.equal(vis.visIdentity.entries[0], direct)
  for (let i = 0; i < resources.length; i++) assert.equal(direct[i].resource, resources[i])
  assert.deepEqual(vis.visSlotGroups, [{}, {}], 'a still image voids nothing')
  vis.textures.color.pages = { buffer: {} }
  ensure()
  assert.deepEqual(vis.visSlotGroups, [undefined, undefined], 'the table names the slot groups')
  vis.visSlotGroups.fill({})
  vis.textures.color.views[0] = {}
  ensure()
  assert.deepEqual(
    vis.visSlotGroups,
    [undefined, undefined],
    'a replaced lane is detected even when its views array stays',
  )
})

test('indirect groups follow buffer changes inside the same draw owner', () => {
  const { rt, device, ensure } = mount()
  const draw = { instanceBuffer: {}, slotOffsetsBuffer: {} }
  Object.assign(rt.vis, { gpuDraw: draw })
  ensure()
  const first = visGroupFor(rt, device, 0, false)
  assert.equal(visGroupFor(rt, device, 0, false), first)
  draw.instanceBuffer = {}
  ensure()
  const second = visGroupFor(rt, device, 0, false)
  assert.notEqual(second, first)
  draw.slotOffsetsBuffer = {}
  ensure()
  assert.notEqual(visGroupFor(rt, device, 0, false), second)
})
