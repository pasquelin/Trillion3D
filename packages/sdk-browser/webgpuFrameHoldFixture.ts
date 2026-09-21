import { createFrameGateCore } from './frameGateCore.ts';
import { HOLD_SIGNATURE_VALUES } from './webgpuFrameSignature.ts';
import { createCpuStepProfile } from './cpuProfile.ts';
import { CPU_STEP_NAMES } from './webgpuPagesCpuSteps.ts';
import type { createDeferredLighting } from './deferredLighting.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

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
