import { resolveProbesPerFrame } from '../../../../../sdk-core/src/bounce/contracts.ts'
import type { BounceFrameMetrics } from '../../../../../sdk-core/src/contracts/shadowMetrics.ts'
import type { MarkSurface } from '../../../lighting/bounce/pool/pool.ts'
import type { GpuBounceProbes } from '../../../lighting/bounce/probes/probes.ts'
import type { ScreenProbeStore } from '../../../lighting/bounce/screen/store.ts'
import type { SurfaceHitReads } from '../../../lighting/surfaceCache/hitWgsl.ts'

/** What the image's probe pass is encoded with, taken when the image's lights are encoded: the lights lit, what the rays' hits read
 *  and what the image drew. */
export interface QueuedBounce {
  lightsActive: number
  reads: SurfaceHitReads
  surface: MarkSurface | undefined
}

/**
 * State of bouncing light: the probe pool and its radiance cache, what the host asked of it, and what the last image
 * actually did. Nothing is allocated per image.
 */
export interface WebgpuBounceState {
  probes: GpuBounceProbes | undefined
  /** The screen probes of the views, made at the first image that casts them
   *  (`lighting/bounce/screen/frame.ts`). */
  screen?: ScreenProbeStore
  /** In-flight making of the probes; it is launched only once, at the first light. */
  pending: Promise<unknown> | undefined
  /** What the host asked. */
  wanted: boolean
  /** The probes an image traces, those never traced first, in the cost of a whole map each (`resolveProbesPerFrame`): the host's
   *  count, none where it named none — the radiance cache's row of the level then (`probesPerFrameOf`). */
  probesPerFrame: number | undefined
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
  /** True when the last image actually encoded the probe pass. */
  encoded: boolean
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
    rayReach: probes?.cascades.reach ?? null,
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

export function createWebgpuBounceState(
  wanted: boolean,
  probesPerFrame?: number,
): WebgpuBounceState {
  return {
    probes: undefined,
    pending: undefined,
    wanted,
    probesPerFrame:
      probesPerFrame === undefined ? undefined : resolveProbesPerFrame(probesPerFrame),
    passMs: null,
    reason: null,
    lightEpoch: 0,
    lightFunctions: -1,
    sceneEpoch: -1,
    probesUpdated: 0,
    encoded: false,
    firstFrameLogged: false,
  }
}
