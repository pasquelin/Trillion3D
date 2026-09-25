import { createFrameGateCore } from '../../frame/gateCore.ts';
import { HOLD_SIGNATURE_VALUES } from './signature.ts';
import { createCpuStepProfile } from '../../stage/cpuProfile.ts';
import { CPU_STEP_NAMES } from '../pages/render/cpuStepTable.ts';
import type { createDeferredLighting } from '../../lighting/deferred/deferred.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import type { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';

/**
 * An `rt` reduced to the strict necessary read by `frameSettled`/`holdWebgpuFrame`/`keepWebgpuFrame`:
 * every `frameSettled` condition is true there by construction. `gpu.presenter` and
 * `gpu.colorTexture` stay absent so hold encodes no present command.
 */
export function settledRt() {
  const run = {
    gate: createFrameGateCore(HOLD_SIGNATURE_VALUES),
    lost: false,
    gpuFrameActive: true,
    gpuMetricsReady: true,
    cutHeld: true,
    overBudget: false,
    coverageBudgetLimited: false,
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
  };
  const rows = {
    rowsChanged: false,
    dirtyTo: -1,
    dirtyFrom: 0,
    rowsEpoch: 1,
    tableEpoch: 1,
    candidateOverflow: 0,
    packedCount: 1,
    rowCount: 1,
  };
  const rt = {
    run,
    layout: { rows },
    vis: { visEnabled: true, gpuDraw: true, textureJobs: [] as unknown[], gpuHiz: undefined },
    lights: {
      plan: {
        counts: { pendingPages: 0, cachedPages: 0, poolPages: 0 },
        pool: { refetched: 0 },
        requests: { counts: { requested: 0 } },
      },
      store: { count: 0 },
      shadowsUpdated: 0,
      shadowFaces: 0,
    },
    bounce: { probes: undefined as unknown },
    capture: { capturing: false, capturePending: false },
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
      effects: undefined as { loading: boolean } | undefined,
      effectsRevision: 0,
    },
    // No effect chain unless a test gives one (`world.effects`).
    context: {} as { effects?: EffectChain },
    sunFar: { pending: undefined as Promise<unknown> | undefined, gpu: undefined as unknown },
  };
  return rt as unknown as WebgpuPagesRuntime & typeof rt;
}

/**
 * A device whose `createRenderPipelineAsync` distinguishes the variant by the module name (set by
 * `createCheckedShaderModule` via `${label}_LIGHTING` / `${label}_COMPOSE`): UNLIT resolves at
 * once, DIRECT and BOUNCE stay pending until `finishCompilation()` (or `failCompilation()`) has
 * been called, exactly like a real compilation that lasts several frames.
 */
export function deferredLightingHarness() {
  let resolveGate: () => void, rejectGate: (error: Error) => void;
  const gate = new Promise<void>((resolve, reject) => {
    resolveGate = resolve;
    rejectGate = reject;
  });
  const { device } = fakeDevice();
  const compile = device.createRenderPipelineAsync;
  device.createRenderPipelineAsync = async (descriptor) => {
    const label = descriptor.fragment?.module.label ?? '';
    if (label.startsWith('DIRECT') || label.startsWith('BOUNCE')) await gate;
    return compile(descriptor);
  };
  return {
    device,
    finishCompilation: () => resolveGate(),
    failCompilation: () => rejectGate(new Error('CONTRACT_COMPILE_FAILED')),
  };
}

export const view = () => ({}) as GPUTextureView;
export const surface = { views: () => [view(), view(), view(), view()] } as unknown as Parameters<
  Awaited<ReturnType<typeof createDeferredLighting>>['bind']
>[0];
