import test from 'node:test';
import assert from 'node:assert/strict';
import { drawBlendPass } from '../blend/draw.ts';
import { orderBlendPasses } from '../blend/order.ts';
import { createWaterPass, encodeWaterPass } from './pass.ts';
import { WATER_COMPOSITE_PASS, WATER_SURFACE_PASS } from './frame.ts';
import { device, mountDevice, prepared, replay, targets } from './pass.fixture.ts';
import { createWebgpuBlendState } from '../blend/state.ts';
import { createWebgpuVisState } from '../pages/state/vis.ts';
import { createWebgpuPagesLayout } from '../pages/prepare/layout.ts';
import { createWebgpuRunState } from '../pages/state/run.ts';
import { dropVis } from '../pages/io/drops.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** The prepared scene, its frame targets, and a real water pass built on a counting device. */
async function mounted() {
  const { blendState, gpu } = prepared();
  targets(gpu);
  const mount = mountDevice();
  blendState.water = await createWaterPass(mount.device, {} as never, {} as never);
  return { blendState, gpu, groups: mount.groups, ...replay(blendState, gpu) };
}

test('the water pass follows the blends: frozen backdrop, surfaces, then one composite', async () => {
  const { rt, encoder, passes, counters } = await mounted();
  drawBlendPass(rt, device, encoder);
  assert.equal(encodeWaterPass(rt, encoder), true, 'the pass was encoded');
  assert.deepEqual(
    passes.map((pass) => pass.label),
    ['WG transparents', WATER_SURFACE_PASS, WATER_COMPOSITE_PASS],
  );
  assert.deepEqual(passes[0].drawn, [0, 2], 'blends draw the two non-transmissive items');
  assert.deepEqual(passes[1].drawn, [1], 'the surface stage draws the transmissive one');
  assert.equal(counters.copies, 2, 'the lit image, and the opaque depth the surface stage tests');
  assert.equal(rt.run.blendDrawCalls, 3, 'the surface draws count as transparent draws');
  assert.equal(rt.run.gpuDrawCalls, 4, 'plus the composite');
});

test('a still frame binds nothing new: the group and the descriptors survive the image', async () => {
  const { rt, encoder, groups } = await mounted();
  encodeWaterPass(rt, encoder);
  const built = groups.created;
  assert.ok(built >= 1, 'the composite group was built once');
  encodeWaterPass(rt, encoder);
  assert.equal(groups.created, built, 'the second image builds no group');
  rt.gpu.backdrop = { ...rt.gpu.backdrop!, colorView: {} as never };
  encodeWaterPass(rt, encoder);
  assert.equal(groups.created, built + 1, 'a resized backdrop rebuilds it');
});

test('glass behind the camera: no copy, no surface pass, no composite', async () => {
  const { rt, encoder, passes, counters, blendState } = await mounted();
  // A frustum whose near plane faces +z rejects a box that lies entirely beyond z = -1.
  blendState.blendPlanes.set([0, 0, -1, -1]);
  blendState.blendGpu[1].bounds = new Float64Array([-1, -1, 5, 1, 1, 6]);
  orderBlendPasses(blendState, [0, 0, 0]);
  assert.equal(blendState.transmissiveInView, 0, 'the only transmissive item is out of view');
  assert.equal(encodeWaterPass(rt, encoder), false);
  assert.equal(counters.copies, 0);
  assert.deepEqual(passes, []);
});

test('without the pass, or without a backdrop, nothing of it is encoded', () => {
  const { blendState, gpu } = prepared();
  targets(gpu);
  const encoder = { copyTextureToTexture: () => assert.fail('no copy without the pass') };
  const rt = {
    gpu,
    blendState,
    run: { diagnostic: 'beauty' },
    capture: {},
  } as unknown as WebgpuPagesRuntime;
  assert.equal(encodeWaterPass(rt, encoder as never), false, 'no pass');
  blendState.water = { surfaces: [{}, {}, {}] as never, frame: {} as never };
  gpu.backdrop = undefined;
  assert.equal(encodeWaterPass(rt, encoder as never), false, 'no backdrop');
});

test('dropping the visibility path disposes the water pass with the blend pipelines', () => {
  const blendState = createWebgpuBlendState();
  let disposed = 0;
  blendState.water = {
    surfaces: [{}, {}, {}] as never,
    frame: { dispose: () => disposed++ } as never,
  };
  const vis = createWebgpuVisState();
  const rt = {
    vis,
    layout: createWebgpuPagesLayout({
      roots: [],
      bootstrap: [],
      slots: 1,
      cap: 1,
      pageBytes: 12,
    } as never),
    run: createWebgpuRunState(),
    gpu: { bindGroups: new Map() },
    blendState,
    capabilities: { materials: '', unsupported: [] as string[] },
  } as unknown as WebgpuPagesRuntime;
  dropVis(rt);
  assert.equal(disposed, 1, 'the frame released its group');
  assert.equal(blendState.water, undefined, 'and the frame no longer has a pass to encode');
});

test('a diagnostic view, or a capture from a second camera, keeps the pass out of the frame', async () => {
  const { rt, encoder, counters } = await mounted();
  rt.run.diagnostic = 'wireframe';
  assert.equal(encodeWaterPass(rt, encoder), false, 'the slice draws as a coloured blend');
  rt.run.diagnostic = 'beauty';
  rt.capture.capturing = true;
  assert.equal(encodeWaterPass(rt, encoder), false, 'the capture reads the surfaces as opaque');
  assert.equal(counters.copies, 0, 'the backdrop is not even frozen');
});
