import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuBindIdentity } from './webgpuBindIdentity.ts';
import { ensureWebgpuVisibilityBindings } from './webgpuVisibilityBindings.ts';
import { ensureWebgpuShadeBindings } from './webgpuShadeBindings.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** A device that counts its groups, and a runtime holding every resource the groups name. */
function mount() {
  let built = 0;
  const device = { createBindGroup: () => ({ id: ++built }) } as unknown as GPUDevice;
  const pool = { view: {} },
    dataPool = { view: {} },
    pages = { buffer: {} };
  const vis = {
    visBindGroupLayout: {},
    shadeBindGroupLayout: {},
    visView: {},
    concatPos: {},
    concatUv: {},
    concatNrm: {},
    pageTable: {},
    visUniform: {},
    shadeUniform: {},
    zeroFlags: {},
    gpuHiz: { flags: {} },
    textures: { color: { pool, pages }, data: { pool: dataPool, pages } },
    mapsSampler: {},
    visBindGroup: undefined as unknown,
    visHizBindGroup: undefined as unknown,
    shadeBindGroup: undefined as unknown,
    visSlotGroups: [undefined, undefined] as unknown[],
    rasterGroups: [undefined] as unknown[],
    visIdentity: createWebgpuBindIdentity(),
    shadeIdentity: createWebgpuBindIdentity(),
  };
  const gpu = { cache: { buffer: {} } };
  const rt = { vis, gpu, run: {} } as unknown as WebgpuPagesRuntime;
  const ensure = () => {
    ensureWebgpuVisibilityBindings(rt, device);
    ensureWebgpuShadeBindings(rt, device);
    return built;
  };
  return { vis, gpu, ensure };
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
  vis.textures.data.pool = { view: {} };
  assert.equal(ensure(), 4, 'the resolve group alone is rebuilt');
  vis.textures.color.pool = { view: {} };
  assert.equal(ensure(), 7, 'the colour atlas is named by all three');
});
