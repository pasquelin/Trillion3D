// GEO-02, non-regression: a held frame can no longer hide the arrival of a contract program.
//
// `holdWebgpuFrame` holds the frame as long as the three revisions and the signature have not
// moved. Compilation of the deferred lighting program finishes between two frames, without any
// step writing it: as long as its arrival incremented no revision, two identical frames froze
// the raw albedo of `unlit` until a foreign invalidation. The `onReady` callback of
// `createDeferredLighting` repairs that at the origin of the change, and that is what this file
// proves with the real bricks: `createDeferredLighting`, `run.gate.resourcesChanged`,
// `holdWebgpuFrame`, `keepWebgpuFrame`. `rt` is mounted by hand, reduced to what `frameSettled`
// reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdWebgpuFrame, keepWebgpuFrame } from './webgpuFrameHold.ts';
import { createDeferredLighting } from './deferredLighting.ts';
import type { DirectLightResources } from './deferredLightingProgram.ts';
import { installGpuGlobals } from '../../tests/kit/gpu/globals.ts';
import { settledRt } from './webgpuFrameHoldFixture.ts';

installGpuGlobals();

/**
 * Fake GPUDevice whose `createRenderPipelineAsync` distinguishes the variant by the module name
 * (set by `createCheckedShaderModule` via `${label}_LIGHTING` / `${label}_COMPOSE`): UNLIT resolves
 * at once, DIRECT and BOUNCE stay pending until `finishCompilation()` has been called, exactly like
 * a real compilation that lasts several frames.
 */
function deferredLightingHarness() {
  let resolveGate: () => void;
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  const device = {
    createBuffer: () => ({ destroy() {} }),
    createShaderModule: (desc: { label?: string }) => ({
      label: desc.label,
      getCompilationInfo: async () => ({ messages: [] }),
    }),
    createBindGroupLayout: () => ({}),
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createSampler: () => ({}),
    createPipelineLayout: () => ({}),
    async createRenderPipelineAsync(descriptor: { fragment?: { module?: { label?: string } } }) {
      const label = descriptor.fragment?.module?.label ?? '';
      if (label.startsWith('DIRECT') || label.startsWith('BOUNCE')) await gate;
      return {};
    },
    createBindGroup: () => ({}),
    queue: { writeBuffer() {} },
  } as unknown as GPUDevice;
  return { device, finishCompilation: () => resolveGate() };
}

const view = () => ({}) as GPUTextureView;
const surface = { views: () => [view(), view(), view(), view()] } as unknown as Parameters<
  Awaited<ReturnType<typeof createDeferredLighting>>['bind']
>[0];
test('GEO-02: the contract program that finishes compiling breaks the held frame', async () => {
  const h = deferredLightingHarness();
  const rt = settledRt();
  // The wiring of `webgpuPagesPrepare.ts`, word for word.
  const lighting = await createDeferredLighting(h.device, {} as GPUBuffer, () =>
    rt.run.gate.resourcesChanged(),
  );
  rt.gpu.deferred = lighting;

  // Two identical real frames: DIRECT compilation is started, `unlit` renders while waiting.
  for (let i = 0; i < 2; i++) {
    lighting.bind(surface, view(), view(), true, {}, () => {});
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  assert.equal(lighting.usesContract, false, 'compilation starts, the render stays unlit');
  assert.equal(rt.run.gate.hold.stable, true, 'two identical frames in a row arm the hold');
  // Holding during compilation remains right: nothing has changed the frame yet.
  assert.equal(holdWebgpuFrame(rt, h.device), true);
  const frameTenue = rt.run.frame;

  // The program arrives: the callback increments resources and breaks the hold.
  const ressources = rt.run.gate.revisions.resources;
  h.finishCompilation();
  await lighting.settle();
  assert.equal(
    rt.run.gate.revisions.resources,
    ressources + 1,
    'the arrived program is a resource',
  );
  assert.equal(holdWebgpuFrame(rt, h.device), false, 'the next frame is remade');
  assert.equal(rt.run.frameHeld, false);

  // The remade frame adopts the contract program: the declared light finally lights.
  lighting.bind(surface, view(), view(), true, {}, () => {});
  rt.run.frame++;
  keepWebgpuFrame(rt);
  assert.equal(lighting.usesContract, true, 'contract draws the frame after arrival');
  assert.equal(rt.run.frame, frameTenue + 1);
});

test('GEO-02: both contract variants announce their arrival, DIRECT as well as BOUNCE', async () => {
  const h = deferredLightingHarness();
  let arrivees = 0;
  const lighting = await createDeferredLighting(h.device, {} as GPUBuffer, () => arrivees++);
  const rebond = { bounceGrid: {}, probes: {} } as unknown as DirectLightResources;
  lighting.bind(surface, view(), view(), true, {}, () => {});
  lighting.bind(surface, view(), view(), true, rebond, () => {});
  assert.equal(arrivees, 0, 'nothing is announced while both compilations last');
  h.finishCompilation();
  await lighting.settle();
  assert.equal(arrivees, 2, 'DIRECT and BOUNCE each announce theirs');
});
