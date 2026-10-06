// An engine whose every `frameSettled` condition is true, for the held-frame tests.
import { createFrameGateCore } from '../../frame/gateCore.ts'
import { HOLD_SIGNATURE_VALUES } from './signature.ts'
import { CPU_STEP_NAMES } from '../pages/render/cpuStepTable.ts'
import { createScaleControl } from '../../frame/scaleControl.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** An engine whose every `frameSettled` condition is true and whose last complete frame drew a
 *  lot: that is what hold must not republish. */
export function heldFrame() {
  const gate = createFrameGateCore(HOLD_SIGNATURE_VALUES)
  gate.hold.keep(gate.revisions)
  gate.hold.keep(gate.revisions)
  const run = {
    gate,
    frameHeld: false,
    frame: 5,
    lost: false,
    desired: [],
    drawn: [],
    gpuFrameActive: true,
    gpuMetricsReady: true,
    cutHeld: true,
    overBudget: false,
    coverageBudgetLimited: false,
    noOccluderHistory: false,
    deferredDrops: new Set(),
    imageRevision: 3,
    gpuDrawCalls: 42,
    blendDrawCalls: 7,
    submittedTriangles: 123456,
    blendSubmittedTriangles: 99,
    cpuSelectMs: 3.5,
    // What the frame SHOWS: the cut, which does not move.
    visible: 800,
    selectedTriangles: 123456,
    frustumRejected: 29987,
    lodLevel: 2,
    blendFrustumRejected: 11,
    cpuHizCounted: false,
  }
  const timing = {
    frameEncoder: undefined,
    lastGpuPassMs: {
      frame: 4,
      totalMs: 9,
      passes: [] as { name: string; gpuMs: number | null }[],
      truncated: false,
    },
    lastGpuFrameMs: 9,
    lastGpuHostGapMs: 2,
    lastSubmitMs: 8,
    cpuProfile: { row: new Float64Array(CPU_STEP_NAMES.length).fill(7) },
    rowFilled: false,
    cpuSample: { version: 1 },
    partitionCounts: {},
  }
  const rt = {
    run,
    views: { active: {} },
    timing,
    context: {},
    scale: createScaleControl(undefined),
    gpu: {
      presenter: { present: () => {}, holds: () => false },
      displayTexture: {},
      targetSize: [4, 4],
      allocatedSize: [4, 4],
      displaySize: [4, 4],
      cache: undefined,
      vertexBytes: 0,
      positionBuffers: new Map(),
    },
    vis: { visEnabled: true, gpuDraw: {}, textureJobs: [], gpuHiz: undefined },
    capture: { capturing: false, capturePending: undefined },
    setup: { geometryPool: { slots: 0 }, texturePool: {} },
    services: {
      bootstrapState: { ready: true },
      residencySets: { keepCount: 0 },
      residency: { busy: false },
      // Count of cut pages still waiting for their bytes, held by the difference.
      cutPending: { count: 0 },
    },
    layout: {
      rows: {
        rowsChanged: false,
        dirtyFrom: 1,
        dirtyTo: -1,
        rowsEpoch: 1,
        tableEpoch: 1,
        candidateOverflow: false,
      },
    },
    lights: {
      changes: { deferred: () => false },
      memory: { bias: 0, events: [] },
    },
    bounce: { probes: undefined },
    blendState: { visibleBlend: [] },
  } as unknown as WebgpuPagesRuntime
  const { device } = fakeDevice()
  return { rt, run, timing, device }
}
