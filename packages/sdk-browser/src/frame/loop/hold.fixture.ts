import assert from 'node:assert/strict'
import { pipelineLabel } from '../../lighting/deferred/compileLedger.ts'
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts'
import { NO_RASTERS } from '../../materials/graph/graphRasters.ts'
import type { GuideSet } from '../../guides/guideSet.ts'
import { createScaleControl } from '../scale/scaleControl.ts'
import { createFrameGateCore } from '../gate/gateCore.ts'
import { HOLD_SIGNATURE_VALUES, SIGNATURE_SLOT } from './signature.ts'
import { createWebgpuTimingState } from '../backend/state/timing.ts'
import type { createDeferredLighting } from '../../lighting/deferred/deferred.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { WebgpuEffects } from '../../post/effects/webgpuEffects.ts'
import { createKindSettings } from '../../post/effects/kindSettings.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { NO_OVERRIDES } from '../backend/state/viewOverrides.ts'
import { createPresentClasses } from '../../gpu/core/presentClasses.ts'
import { createRootOffsets } from '../render/rootOffsets.ts'

/**
 * An `rt` reduced to the strict necessary read by `frameSettled`/`holdWebgpuFrame`/`keepWebgpuFrame`:
 * every `frameSettled` condition is true there by construction. `gpu.presenter` and
 * `gpu.displayTexture` stay absent so hold encodes no present command.
 */
export function settledRt() {
  const run = {
    gate: createFrameGateCore(HOLD_SIGNATURE_VALUES),
    lost: false,
    gpuMetricsReady: true,
    cutHeld: true,
    overBudget: false,
    coverageBudgetLimited: false,
    noOccluderHistory: false,
    deferredDrops: new Set<string>(),
    frame: 0,
    frameHeld: false,
    heldEmpty: false,
    imageRevision: 0,
    // Fields read by `sampleWebgpuFrame`: constant from frame to frame so `keep()` judges two
    // consecutive frames identical.
    cutEpoch: 1,
    pageArrayEpoch: 1,
    visible: 1,
    selectedTriangles: 3,
    submittedTriangles: 3,
    frustumRejected: 0,
    lodLevel: 0,
    gpuDrawCalls: 2,
    blendDrawCalls: 0,
    blendSubmittedTriangles: 0,
    blendFrustumRejected: 0,
  }
  // One packed page, opaque, its cluster record written: what `sampleWebgpuFrame` and the mask of
  // what a still view owes read of the layout.
  const clusters = { infoEpoch: 1, touchRevision: () => 0 }
  // The main view alone, drawn, its scale the world's controller.
  const scale = createScaleControl(undefined),
    main = { scale, overrides: NO_OVERRIDES }
  const rt = {
    run,
    // The project switch of the local fog volumes, on (the programs the session makes hold their code).
    setup: { localFog: true },
    views: { main, active: main, persistent: [] },
    // No root: the frame entry asks no roots' pass (`askFramePipelines`).
    layout: {
      clusters,
      packedPages: [{}] as unknown[],
      blendedPageCount: 0,
      selectionRoots: [] as unknown[],
      rootIndex: { revision: 0 },
    },
    vis: {
      displacedClasses: createPresentClasses(),
      textureJobs: [] as unknown[],
      gpuHiz: undefined,
      // No displaced surface: the frame tessellates nothing (`tessellationWanted`).
      materialTable: { displaced: { count: 0 }, offsetEpoch: 0, dithers: false },
      // No graph output the rasters hold, none joined late.
      rasters: NO_RASTERS,
      rasterRebuild: undefined,
      // No root is in a lighting channel but the default's (`channelledFor`).
      rootOffsets: createRootOffsets(),
    },
    lights: {
      // A manual exposure: the lit image asks no exposure meter (`../../post/exposure/frame.ts`).
      store: { count: 0, epoch: 1, environment: { exposure: 1 } },
      // The declared-light buffer prepare makes before any frame (`preparePages.ts`): the one the
      // lit program binds (`directLightResources`).
      buffer: {} as GPUBuffer,
    },
    bounce: { probes: undefined as unknown },
    capture: { capturing: false, capturePending: false },
    services: {
      bootstrapState: { ready: true },
      // No cluster owes its record.
      clustersOwed: () => false,
      residency: { busy: false, progress: async () => {} },
      // Count of cut pages still waiting for their bytes, held by the difference.
      cutPending: { count: 0 },
    },
    timing: {
      frameEncoder: undefined as unknown,
      // `recordHeldFrameWork` writes the row of a held frame in the real profile, as in production: a
      // hand-built object would not have the exact width of `CPU_STEP`.
      profiler: createWebgpuTimingState().profiler,
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
      displayTexture: undefined as unknown,
      displaySize: [4, 4] as [number, number],
      targetSize: [4, 4] as [number, number],
      allocatedSize: [4, 4] as [number, number],
      deferred: undefined as Awaited<ReturnType<typeof createDeferredLighting>> | undefined,
      effects: undefined as WebgpuEffects | undefined,
      effectsRevision: 0,
      kindSettings: createKindSettings(),
      guideRevision: 0,
    },
    // No effect chain and no guides unless a test gives them (`world.effects`, `world.guides`).
    context: {} as { effects?: EffectChain; guides?: GuideSet },
    // No transparent: the frame entry asks no share seed (`askFramePipelines`).
    blendState: { blendGpu: [] as unknown[], blendIndex: { revision: 0 }, channelled: false },
    // A session without traces: a drawn frame says nothing (`traceDrawnFrame`).
    diag: { traceEnabled: false },
  }
  return rt as unknown as WebgpuPagesRuntime & typeof rt
}

/** The counters a held frame rewrites, in the signature's own names. */
const COUNTERS = Object.keys(SIGNATURE_SLOT) as (keyof typeof SIGNATURE_SLOT)[]

/**
 * The final image of an establishment: everything is established and the view still, and the frame entry draws one image more, at the canonical phase of the noise (`finalNoiseImage`), before it
 * holds. Asked once, it checks that this image is drawn, lets the test encode it (`draw`), and plays its end as the frame entry does (the image number advances, the frame is kept); the holds that follow are the view's.
 */
export function drawFinalImage(rt: WebgpuPagesRuntime, device: GPUDevice, draw = () => {}) {
  assert.equal(
    holdWebgpuFrame(rt, device),
    false,
    'established: the final image is drawn before the hold',
  )
  assert.equal(rt.run.frameHeld, false)
  // The image draws what the frames before it drew (a held frame wrote its own counters, which the signature would read as another image).
  const { sample } = rt.run.gate.hold
  for (const counter of COUNTERS) rt.run[counter] = sample[SIGNATURE_SLOT[counter]]
  draw()
  rt.run.frame++
  keepWebgpuFrame(rt)
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
    const label = pipelineLabel(descriptor)
    if (label.startsWith('DIRECT') || label.startsWith('BOUNCE')) await gate
    return compile.call(device, descriptor)
  }
  return {
    device,
    finishCompilation: () => resolveGate(),
    failCompilation: () => rejectGate(new Error('CONTRACT_COMPILE_FAILED')),
  }
}

export const view = () => ({}) as GPUTextureView
export const surface = {
  views: () => [view(), view(), view(), view()],
  stores: () => [view(), view()],
} as unknown as Parameters<Awaited<ReturnType<typeof createDeferredLighting>>['bind']>[0]
