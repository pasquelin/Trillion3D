import type { BounceFrameMetrics } from '../../../../../sdk-core/src/contracts/shadowMetrics.ts'
import type { MarkSurface } from '../../../lighting/bounce/pool/pool.ts'
import type { GpuBounceProbes } from '../../../lighting/bounce/probes/probes.ts'
import type { ScreenProbeStage } from '../../../lighting/bounce/screen/stage.ts'
import type { ScreenProbeStore } from '../../../lighting/bounce/screen/store.ts'
import type { SurfaceHitReads } from '../../../lighting/surfaceCache/hitWgsl.ts'
import type { SceneRays } from '../../../lighting/surfaceCache/lighting/surfaceLighting.ts'
import type { IrradianceFieldHold } from '../../../lighting/bounce/irradianceField/cache.ts'
import type { TranslucencyCacheHold } from '../../../lighting/translucencyGi/cache.ts'

/** What the image's probe pass is encoded with, taken when the image's lights are encoded: the lights lit, what the rays' hits read,
 *  the scene trace the rays may be cast through (none where the image made none) and what the image drew. */
export interface QueuedBounce {
  reads: SurfaceHitReads
  rays: SceneRays | undefined
  surface: MarkSurface | undefined
}

/**
 * State of bouncing light: the probe pool and its radiance cache, what the host asked of it, and what the last image
 * actually did. Nothing is allocated per image.
 */
export interface WebgpuBounceState {
  probes: GpuBounceProbes | undefined
  /** The radiance cache of the translucency volume's own (`lighting/translucencyGi/cache.ts`), made where the volume reads one that is
   *  not the world's. */
  translucency?: TranslucencyCacheHold
  /** The radiance cache of the irradiance field (`lighting/bounce/irradianceField/cache.ts`), made where the indirect light is gathered by the field. */
  irradianceField?: IrradianceFieldHold
  /** The screen probes of the views, made at the first image that casts them
   *  (`lighting/bounce/screen/frame.ts`). */
  screen?: ScreenProbeStore
  /** A stage a pass of the frame adds to the screen probes' pass, set again at each image by the pass that brings it (the hair strands'
   *  environment light, `hair/environment.ts`): none else. */
  stage?: ScreenProbeStage
  /** In-flight making of the probes; it is launched only once, at the first light. */
  pending: Promise<unknown> | undefined
  /** What the host asked. */
  wanted: boolean
  /** The GPU duration of the bounce stage in the last timed image, in milliseconds: a measure, nothing
   *  steers by it; null until one was timed. */
  passMs: number | null
  /** Why bounce does not exist, when it does not. */
  reason: string | null
  /** Light-store revision already seen: a change restarts convergence. */
  lightEpoch: number
  /** The light functions' atlas as the bounce's lights read it (`lightFunctionRevision`) already seen: a change restarts it too. */
  lightFunctions: number
  /** Scene revision the probes last followed the placements at, -1 before any
   *  (`../../prepare/bounce.ts`, `syncBouncePlacements`). */
  sceneEpoch: number
  /** Probes queued by the last image; zero when nothing was encoded. */
  probesUpdated: number
  /** The greatest channel of the colour of the sun the bounce follows (the first directional light that gives indirect light) and of the
   *  sky light, as the last image held them, zero for none (`../../prepare/globalLighting.ts`, `followGlobalLighting`). */
  sunColour: number
  skyColour: number
  /** Whether this image saw a big change of the lighting that the bounce follows at once: the screen probes read no history in it
   *  (`../../prepare/globalLighting.ts`, `followGlobalLighting`; refilled each image). */
  historyLost: boolean
  /** What the probe pass this image holds back until its screen probes are placed is encoded with (`../../render/encodeLights.ts`,
   *  `encodeBounce`, `encodeQueuedBounce`); none once encoded, or where the image casts no screen probe. */
  queued?: QueuedBounce
  firstFrameLogged: boolean
}

/** What the CPU knows of the probes and of the image just drawn: the probes alive and the marks, the
 *  probes queued, whether the series is closed. */
function rigState(bounce: WebgpuBounceState) {
  const probes = bounce.probes
  return {
    rigged: !!probes,
    loading: !probes && !!bounce.pending && !bounce.reason,
    unavailable: bounce.reason,
    probes: probes?.cascades.probes ?? null,
    liveProbes: probes ? probes.stats.live : null,
    // Probes alive that still hold nothing: zero says the light the image reads is filled.
    unfilledProbes: probes ? probes.stats.unfilled : null,
    refusedMarks: probes ? probes.stats.refused : null,
    marksRead: probes ? probes.stats.reads : null,
    cellsMarked: probes ? probes.stats.marked : null,
    probesUpdated: bounce.probesUpdated,
    passMs: probes ? bounce.passMs : null,
    converged: probes ? !probes.working : null,
    // What the placements held at the last sync of the probes with them.
    placements: probes?.placements() ?? null,
  }
}

/** Bounce state, as the image diagnostics, the frame's metrics and the per-stage profile publish it:
 *  the CPU's counts of the image just drawn. */
export function bounceState(bounce: WebgpuBounceState): BounceFrameMetrics {
  return {
    ...rigState(bounce),
    screen: bounce.screen?.metrics,
  }
}

export function createWebgpuBounceState(wanted: boolean): WebgpuBounceState {
  return {
    probes: undefined,
    pending: undefined,
    wanted,
    passMs: null,
    reason: null,
    lightEpoch: 0,
    lightFunctions: -1,
    sceneEpoch: -1,
    probesUpdated: 0,
    sunColour: 0,
    skyColour: 0,
    historyLost: false,
    firstFrameLogged: false,
  }
}
