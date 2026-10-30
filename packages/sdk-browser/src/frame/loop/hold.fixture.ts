import assert from 'node:assert/strict'
import { pipelineLabel } from '../../lighting/deferred/compileLedger.ts'
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts'
import { NO_RASTERS } from '../../materials/graph/graphRasters.ts'
import type { GuideSet } from '../../guides/guideSet.ts'
import { createScaleControl } from '../scale/scaleControl.ts'
import { createFrameGateCore } from '../gate/gateCore.ts'
import { HOLD_SIGNATURE_VALUES, sampleWebgpuFrame } from './signature.ts'
import { STOCHASTIC_SLOTS } from '../../post/taa/frameState.ts'
import { isFinalImage } from '../render/finalImage.ts'
import { createImageScratch } from '../backend/state/gpu.ts'
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
import { taaForgettingImages } from '../../post/taa/landing.ts'

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
    hold: { heldOn: undefined, entries: 0, last: undefined },
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
      // No class the path tracer shades.
      pathTracedClasses: [] as number[],
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
      store: { count: 0, epoch: 1, environment: { exposure: 1 }, simple: { capacity: 0 } },
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
      images: createImageScratch(),
    },
    // No effect chain and no guides unless a test gives them (`world.effects`, `world.guides`).
    context: {} as { effects?: EffectChain; guides?: GuideSet },
    // No transparent: the frame entry asks no share seed (`askFramePipelines`).
    blendState: { blendGpu: [] as unknown[], waterItems: [] as unknown[], blendIndex: { revision: 0 }, channelled: false },
    // A session without traces: a drawn frame says nothing (`traceDrawnFrame`).
    diag: { traceEnabled: false },
  }
  return rt as unknown as WebgpuPagesRuntime & typeof rt
}

/** The images a view is given to hold: those of its establishment, a cycle of the noise after its last change, and the final image. */
export const HOLD_WITHIN = 8 + STOCHASTIC_SLOTS + 1

/** The counters a held frame rewrites (`recordHeldFrameWork`), in the signature's own names. */
const COUNTERS = [
  'submittedTriangles',
  'gpuDrawCalls',
  'blendDrawCalls',
  'blendSubmittedTriangles',
] as const

/** The slot of the signature each of `COUNTERS` stands in, read off a sample of the signature's own function over distinct counters: the one place the layout is written stays the signature's. */
const SIGNATURE_SLOT = (() => {
  const run = Object.fromEntries(COUNTERS.map((counter, k) => [counter, 1000 + k]))
  const probe = {
    run: { gpuSelection: undefined, ...run },
    layout: { packedPages: [], clusters: { infoEpoch: 0, touchRevision: () => 0 } },
  } as unknown as Parameters<typeof sampleWebgpuFrame>[0]
  const into = new Float64Array(HOLD_SIGNATURE_VALUES)
  sampleWebgpuFrame(probe, into)
  return Object.fromEntries(
    COUNTERS.map((counter, k) => {
      const slot = into.indexOf(1000 + k)
      assert.ok(slot >= 0, `${counter} stands in the signature`)
      return [counter, slot]
    }),
  ) as Record<(typeof COUNTERS)[number], number>
})()

/**
 * The images an establishment draws once everything else is established, the last of them the final one at the canonical phase of the noise (`isFinalImage`): each is checked to be drawn,
 * lets the test encode it (`draw`, told whether it is the final one) and plays its end as the frame entry does (the image number advances, the frame is kept); the holds that follow
 * are the view's. Returns the images drawn: at most a cycle of the noise and the final image.
 */
export function drawFinalImage(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  draw: (final: boolean) => void = () => {},
) {
  let drawn = 0,
    final = false
  // A temporal history that followed a change is drawn on till it has forgotten the view before it (`taaForgettingImages`), then a cycle of the noise.
  const temporal = rt.gpu.temporal?.frame,
    forgetting = temporal
      ? taaForgettingImages(temporal, rt.gpu.targetSize[0], rt.gpu.displaySize[0])
      : 0
  while (!final) {
    assert.ok(
      drawn <= forgetting + STOCHASTIC_SLOTS,
      'the final image comes within the history’s forgetting and a cycle of the noise',
    )
    assert.equal(
      holdWebgpuFrame(rt, device),
      false,
      'established: the image is drawn before the hold',
    )
    assert.equal(rt.run.frameHeld, false)
    // The image draws what the frames before it drew (a held frame wrote its own counters, which the signature would read as another image).
    const { sample } = rt.run.gate.hold
    for (const counter of COUNTERS) rt.run[counter] = sample[SIGNATURE_SLOT[counter]]
    final = isFinalImage(rt.run)
    draw(final)
    rt.run.frame++
    keepWebgpuFrame(rt)
    drawn++
  }
  return drawn
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
