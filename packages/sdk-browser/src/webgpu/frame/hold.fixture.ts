import type { GuideSet } from '../../guides/guideSet.ts'
import { createScaleControl } from '../../frame/scaleControl.ts'
import { createFrameGateCore } from '../../frame/gateCore.ts'
import { HOLD_SIGNATURE_VALUES } from './signature.ts'
import { createCpuStepProfile } from '../../stage/cpuProfile.ts'
import { CPU_STEP_NAMES } from '../pages/render/cpuStepTable.ts'
import type { createDeferredLighting } from '../../lighting/deferred/deferred.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { WebgpuEffects } from '../effects/webgpuEffects.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'

/**
 * An `rt` reduced to the strict necessary read by `frameSettled`/`holdWebgpuFrame`/`keepWebgpuFrame`:
 * every `frameSettled` condition is true there by construction. `gpu.presenter` and
 * `gpu.displayTexture` stay absent so hold encodes no present command.
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
  }
  const rows = {
    rowsChanged: false,
    dirtyTo: -1,
    dirtyFrom: 0,
    rowsEpoch: 1,
    tableEpoch: 1,
    candidateOverflow: 0,
    packedCount: 1,
    rowCount: 1,
  }
  // The main view alone, drawn.
  const main = {}
  const rt = {
    run,
    views: { main, active: main, persistent: [] },
    layout: { rows },
    vis: { visEnabled: true, gpuDraw: true, textureJobs: [] as unknown[], gpuHiz: undefined },
    lights: {
      changes: { deferred: () => false },
      store: { count: 0 },
    },
    bounce: { probes: undefined as unknown },
    capture: { capturing: false, capturePending: false },
    services: {
      bootstrapState: { ready: true },
      residency: { busy: false, progress: async () => {} },
      // Count of cut pages still waiting for their bytes, held by the difference.
      cutPending: { count: 0 },
    },
    timing: {
      frameEncoder: undefined as unknown,
      partitionCounts: { occluders: 0, tested: 0, previousOccluders: 0 },
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
    scale: createScaleControl(undefined),
    gpu: {
      presenter: undefined as unknown,
      displayTexture: undefined as unknown,
      displaySize: [4, 4] as [number, number],
      targetSize: [4, 4] as [number, number],
      allocatedSize: [4, 4] as [number, number],
      deferred: undefined as Awaited<ReturnType<typeof createDeferredLighting>> | undefined,
      effects: undefined as WebgpuEffects | undefined,
      effectsRevision: 0,
      guideRevision: 0,
    },
    // No effect chain and no guides unless a test gives them (`world.effects`, `world.guides`).
    context: {} as { effects?: EffectChain; guides?: GuideSet },
    // No transparent: the frame entry asks no share seed (`askFramePipelines`).
    blendState: { blendGpu: [] as unknown[] },
  }
  return rt as unknown as WebgpuPagesRuntime & typeof rt
}

/**
 * A device whose `createRenderPipelineAsync` distinguishes the variant by the module name (set by
 * `createCheckedShaderModule` via `${label}_LIGHTING` / `${label}_COMPOSE`): UNLIT resolves at
 * once, DIRECT and BOUNCE stay pending until `finishCompilation()` (or `failCompilation()`) has
 * been called, exactly like a real compilation that lasts several frames.
 */
export function deferredLightingHarness() {
  let resolveGate: () => void, rejectGate: (error: Error) => void
  const gate = new Promise<void>((resolve, reject) => {
    resolveGate = resolve
    rejectGate = reject
  })
  const { device } = fakeDevice()
  const compile = device.createRenderPipelineAsync
  device.createRenderPipelineAsync = async (descriptor) => {
    const label = descriptor.fragment?.module.label ?? ''
    if (label.startsWith('DIRECT') || label.startsWith('BOUNCE')) await gate
    return compile(descriptor)
  }
  return {
    device,
    finishCompilation: () => resolveGate(),
    failCompilation: () => rejectGate(new Error('CONTRACT_COMPILE_FAILED')),
  }
}

export const view = () => ({}) as GPUTextureView
export const surface = { views: () => [view(), view(), view(), view()] } as unknown as Parameters<
  Awaited<ReturnType<typeof createDeferredLighting>>['bind']
>[0]
