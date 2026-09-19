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
import { createFrameGateCore } from './frameGateCore.ts';
import { HOLD_SIGNATURE_VALUES } from './webgpuFrameSignature.ts';
import { createCpuStepProfile } from './cpuProfile.ts';
import { CPU_STEP_NAMES } from './webgpuPagesCpuSteps.ts';
import { createDeferredLighting } from './deferredLighting.ts';
import type { DirectLightResources } from './deferredLightingProgram.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

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
/**
 * An `rt` reduced to the strict necessary read by `frameSettled`/`holdWebgpuFrame`/`keepWebgpuFrame`:
 * every `frameSettled` condition is true there by construction. `gpu.presenter` and
 * `gpu.colorTexture` stay absent so hold encodes no present command.
 */
function settledRt() {
  const run = {
    gate: createFrameGateCore(HOLD_SIGNATURE_VALUES),
    lost: false,
    gpuFrameActive: true,
    gpuMetricsReady: true,
    cutHeld: true,
    overBudget: false,
    coverageBudgetLimited: false,
    uncoveredTriangles: 0,
    noOccluderHistory: false,
    deferredDrops: new Set<string>(),
    frame: 0,
    frameHeld: false,
    imageRevision: 0,
    // Fields read by `sampleWebgpuFrame`: constant from frame to frame so `keep()` judges two
    // consecutive frames identical.
    cutEpoch: 1,
    pageArrayEpoch: 1,
    visible: 1,
    selectedTriangles: 3,
    submittedTriangles: 3,
    drawnTriangles: 3,
    frustumRejected: 0,
    lodLevel: 0,
    gpuDrawCalls: 2,
    blendDrawCalls: 0,
    blendSubmittedTriangles: 0,
    blendFrustumRejected: 0,
    occluderSignature: 0,
    budgetPixelError: 0,
  };
  const rows = {
    rowsChanged: false,
    dirtyTo: -1,
    dirtyFrom: 0,
    rowsEpoch: 1,
    tableEpoch: 1,
    candidateOverflow: false,
    packedCount: 1,
    rowCount: 1,
  };
  const rt = {
    run,
    layout: { rows },
    vis: { visEnabled: true, gpuDraw: true, textureJobs: [] as unknown[], gpuHiz: undefined },
    lights: { plan: { counts: { pendingPages: 0 } }, shadowsUpdated: 0, shadowFaces: 0 },
    bounce: { probes: undefined as unknown },
    capture: { secondaryCamera: false, capturePending: false },
    services: {
      bootstrapState: { ready: true },
      residency: { busy: false },
      // Count of cut pages still waiting for their bytes, held by the difference.
      cutPending: { count: 0 },
    },
    timing: {
      frameEncoder: undefined as unknown,
      partitionCounts: { occulteurs: 0, testees: 0, historiqueOcculteurs: 0 },
      // `recordHeldFrameWork` writes the row of a held frame in the real profile, as in production: a
      // hand-built object would not have the exact width of `CPU_STEP`.
      cpuProfile: createCpuStepProfile(CPU_STEP_NAMES),
      rowFilled: false,
      cpuSample: undefined as Record<string, unknown> | undefined,
      lastGpuPassMs: null as number | null,
      lastGpuFrameMs: null as number | null,
      lastGpuHostGapMs: null as number | null,
      lastSubmitMs: null as number | null,
    },
    texturePump: { inFlight: false },
    gpu: {
      presenter: undefined as unknown,
      colorTexture: undefined as unknown,
      deferred: undefined as Awaited<ReturnType<typeof createDeferredLighting>> | undefined,
    },
    sunFar: { pending: undefined as Promise<unknown> | undefined, gpu: undefined as unknown },
  };
  return rt as unknown as WebgpuPagesRuntime & typeof rt;
}

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
