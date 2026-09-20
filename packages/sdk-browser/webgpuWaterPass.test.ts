import test from 'node:test';
import assert from 'node:assert/strict';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { encodeWaterPass, WATER_SURFACE_PASS } from './webgpuWaterPass.ts';
import { WATER_COMPOSITE_PASS } from './webgpuWaterComposite.ts';
import { device, prepared, targets } from './webgpuWaterPassFixture.ts';
import type { WebgpuGpuState } from './webgpuPagesStateGpu.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Replays the frame's transparent passes: their labels, the items each drew, and the copies. */
function frame(blendState: ReturnType<typeof prepared>['blendState'], gpu: WebgpuGpuState) {
  const passes: { label: string; drawn: number[] }[] = [];
  let current: number[] = [];
  const items = blendState.blendGpu;
  for (const item of items) item.group = {} as GPUBindGroup;
  const pass = {
    setViewport() {},
    setBindGroup(_slot: number, group: GPUBindGroup) {
      current.push(items.findIndex((item) => item.group === group));
    },
    setPipeline() {},
    drawIndirect() {},
    end() {},
  };
  let copies = 0;
  const encoder = {
    beginRenderPass: ({ label }: { label: string }) => {
      current = [];
      passes.push({ label, drawn: current });
      return pass;
    },
    copyTextureToTexture: () => copies++,
  } as unknown as GPUCommandEncoder;
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
  const rt = {
    vis: {
      visEnabled: true,
      pipelineBlendFront: {},
      pipelineBlendBack: {},
      pipelineBlendTextured: {},
    },
    gpu,
    lights: { buffer: {}, shadows: undefined, store: { count: 0, unlit: false } },
    bounce: { probes: undefined },
    // `lit` view with no light: the contract lights, so the pass binds its resources by default.
    sunFar: { gpu: undefined },
    blendState,
    run: {
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendUnpagedTriangles: 0,
      blendPagedTriangles: 0,
      blendSubmittedTriangles: 0,
      feedbackWritten: true,
    },
  } as unknown as WebgpuPagesRuntime;
  // Groups are already built on these lighting resources: the pass therefore need not rebuild them,
  // and this test observes draw order, not group construction.
  const p = gpu.deferred!.placeholders;
  blendState.lighting = {
    directLights: rt.lights.buffer!,
    shadowSlices: p.slices,
    shadowAtlas: p.atlasView,
    shadowSampler: p.sampler,
    bounceGrid: p.bounceGrid,
    probes: p.probes,
    tileLights: p.tiles,
    proxy: p.proxy,
  };
  // No paged item here, and the shared group is posted ahead for the same reason.
  blendState.pagedGroup = {} as GPUBindGroup;
  drawBlendPass(rt, device, encoder);
  const water = encodeWaterPass(rt, device, encoder, new Float64Array(16));
  return { passes, copies, composite, water, rt };
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
