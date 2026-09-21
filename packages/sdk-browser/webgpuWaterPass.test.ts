import test from 'node:test';
import assert from 'node:assert/strict';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { encodeWaterPass, WATER_SURFACE_PASS } from './webgpuWaterPass.ts';
import { WATER_COMPOSITE_PASS } from './webgpuWaterComposite.ts';
import { device, prepared, replay, targets } from './webgpuWaterPassFixture.ts';
import type { WebgpuGpuState } from './webgpuPagesStateGpu.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { createWebgpuVisState } from './webgpuPagesStateVis.ts';
import { createWebgpuPagesLayout } from './webgpuPagesLayout.ts';
import { createWebgpuRunState } from './webgpuPagesStateRun.ts';
import { dropVis } from './webgpuPagesDrops.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Replays the frame's transparent passes with a counting composite in place of the real one. */
function frame(blendState: ReturnType<typeof prepared>['blendState'], gpu: WebgpuGpuState) {
  const { rt, encoder, passes, counters } = replay(blendState, gpu);
  const composite = { updates: 0, binds: 0, composed: 0 };
  blendState.water = {
    surfaces: [{}, {}, {}] as never,
    composite: {
      update: () => composite.updates++,
      bind: () => composite.binds++,
      compose: (enc: GPUCommandEncoder) => {
        composite.composed++;
        enc.beginRenderPass({ label: WATER_COMPOSITE_PASS } as never).end();
      },
      dispose() {},
    },
  };
  drawBlendPass(rt, device, encoder);
  const water = encodeWaterPass(rt, device, encoder, new Float64Array(16));
  return { passes, copies: counters.copies, composite, water, rt };
}

test('the water pass follows the blends: frozen backdrop, surfaces, then one composite', () => {
  const { blendState, gpu } = prepared();
  targets(gpu);
  const { passes, copies, composite, water, rt } = frame(blendState, gpu);
  assert.equal(water, true, 'the pass was encoded');
  assert.deepEqual(
    passes.map((pass) => pass.label),
    ['WG transparents', WATER_SURFACE_PASS, WATER_COMPOSITE_PASS],
  );
  assert.deepEqual(passes[0].drawn, [0, 2], 'blends draw the two non-transmissive items');
  assert.deepEqual(passes[1].drawn, [1], 'the surface stage draws the transmissive one');
  assert.equal(copies, 3, 'colour, opaque depth, and the depth the surface stage tests');
  assert.deepEqual(composite, { updates: 1, binds: 1, composed: 1 });
  assert.equal(rt.run.blendDrawCalls, 3, 'the surface draws count as transparent draws');
});

test('without the pass, or without a backdrop, nothing of it is encoded', () => {
  const { blendState, gpu } = prepared();
  targets(gpu);
  const encoder = { copyTextureToTexture: () => assert.fail('no copy without the pass') };
  const rt = { gpu, blendState, run: {} } as unknown as WebgpuPagesRuntime;
  const inverse = new Float64Array(16);
  assert.equal(encodeWaterPass(rt, device, encoder as never, inverse), false, 'no pass');
  blendState.water = { surfaces: [{}, {}, {}] as never, composite: {} as never };
  gpu.backdrop = undefined;
  assert.equal(encodeWaterPass(rt, device, encoder as never, inverse), false, 'no backdrop');
});

test('dropping the visibility path disposes the water pass with the blend pipelines', () => {
  const blendState = createWebgpuBlendState();
  let disposed = 0;
  blendState.water = {
    surfaces: [{}, {}, {}] as never,
    composite: { dispose: () => disposed++ } as never,
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
  assert.equal(disposed, 1, 'the composite released its view buffer');
  assert.equal(blendState.water, undefined, 'and the frame no longer has a pass to encode');
});

test('a diagnostic view keeps the pass out of the frame: the slice draws as a coloured blend', () => {
  const { blendState, gpu } = prepared();
  targets(gpu);
  const { rt, encoder, counters } = replay(blendState, gpu);
  blendState.water = { surfaces: [{}, {}, {}] as never, composite: {} as never };
  rt.run.diagnostic = 'wireframe';
  assert.equal(encodeWaterPass(rt, device, encoder, new Float64Array(16)), false);
  assert.equal(counters.copies, 0, 'the backdrop is not even frozen');
});
