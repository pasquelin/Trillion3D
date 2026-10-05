import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts';
import { ensureWebgpuVisibilityBindings } from './bindings.ts';
import { ensureWebgpuShadeBindings } from '../core/shadeBindings.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { visGroupFor } from './visGroup.ts';

/** A device that counts its groups, and a runtime holding every resource the groups name. */
function mount() {
  const { device, bindGroups } = fakeDevice();
  const snapshots: unknown[][] = [],
    create = device.createBindGroup.bind(device);
  device.createBindGroup = (descriptor) => {
    snapshots.push(
      Array.from(descriptor.entries, ({ resource }) =>
        'buffer' in resource ? resource.buffer : resource,
      ),
    );
    return create(descriptor);
  };
  const views = [{}, {}, {}],
    dataViews = [{}, {}, {}],
    pages = { buffer: {} };
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
    visBindGroup: undefined as unknown,
    visHizBindGroup: undefined as unknown,
    shadeBindGroup: undefined as unknown,
    visSlotGroups: [undefined, undefined] as unknown[],
    rasterGroups: [undefined] as unknown[],
    visIdentity: createWebgpuBindIdentity(),
    shadeIdentity: createWebgpuBindIdentity(),
  };
  const gpu = { cache: { buffer: {} }, surfaces: { subsurfaceView: {}, receiverView: {} } };
  const rt = { vis, gpu, run: {} } as unknown as WebgpuPagesRuntime;
  const ensure = () => {
    ensureWebgpuVisibilityBindings(rt, device);
    ensureWebgpuShadeBindings(rt, device);
    return bindGroups.length;
  };
  return { vis, gpu, rt, device, ensure, bindGroups, snapshots };
}

test('a resized page pool voids every group that named it, by identity alone', () => {
  const { vis, gpu, ensure } = mount();
  assert.equal(ensure(), 3, 'direct, Hi-Z and resolve groups built once');
  // Slot and raster groups are built by their own passes on the same resources.
  vis.visSlotGroups.fill({});
  vis.rasterGroups.fill({});
  assert.equal(ensure(), 3, 'a still image rebuilds nothing');
  assert.deepEqual(vis.visSlotGroups, [{}, {}], 'the slot groups are held with them');
  // The pool was resized: another buffer, in the same place, and no drop by name anywhere.
  gpu.cache = { buffer: {} };
  assert.equal(ensure(), 6, 'the three groups are rebuilt');
  assert.deepEqual(vis.visSlotGroups, [undefined, undefined]);
  assert.deepEqual(vis.rasterGroups, [undefined]);
});

test('an atlas that changed layers voids only the groups that sample it', () => {
  const { vis, ensure } = mount();
  ensure();
  // The data atlas: sampled by the resolve, never by the visibility raster.
  vis.textures.data.views = [{}, {}, {}];
  assert.equal(ensure(), 4, 'the resolve group alone is rebuilt');
  vis.textures.color.views = [{}, {}, {}];
  assert.equal(ensure(), 7, 'the colour atlas is named by all three');
});

test('atlas entries alone govern table and individual lane invalidation; stable reads reuse descriptors', () => {
  const { vis, ensure, bindGroups, snapshots } = mount();
  ensure();
  const arrays = vis.visIdentity.entries.slice();
  const direct = arrays[0];
  const resources = direct.map((entry) => entry.resource);
  assert.equal(ensure(), 3);
  assert.equal(vis.visIdentity.entries[0], direct);
  for (let i = 0; i < resources.length; i++) assert.equal(direct[i].resource, resources[i]);
  vis.textures.color.pages = { buffer: {} };
  assert.equal(ensure(), 6, 'the table was absent from the old handwritten identity');
  assert.ok(snapshots[3].includes(vis.textures.color.pages.buffer));
  assert.ok(
    !snapshots[0].includes(vis.textures.color.pages.buffer),
    'creation snapshots stay fixed',
  );
  assert.equal(bindGroups.at(-3)!.entries, direct, 'construction consumes the identity entries');
  vis.textures.data.views[1] = {};
  assert.equal(ensure(), 7, 'a replaced lane is detected even when its views array stays');
  vis.textures.color.views[0] = {};
  assert.equal(ensure(), 10);
});

test('indirect groups follow buffer changes inside the same draw owner', () => {
  const { rt, device, ensure } = mount();
  const draw = { instanceBuffer: {}, slotOffsetsBuffer: {} };
  Object.assign(rt.vis, { gpuDraw: draw });
  ensure();
  const first = visGroupFor(rt, device, 0, false);
  assert.equal(visGroupFor(rt, device, 0, false), first);
  draw.instanceBuffer = {};
  ensure();
  const second = visGroupFor(rt, device, 0, false);
  assert.notEqual(second, first);
  draw.slotOffsetsBuffer = {};
  ensure();
  assert.notEqual(visGroupFor(rt, device, 0, false), second);
});
