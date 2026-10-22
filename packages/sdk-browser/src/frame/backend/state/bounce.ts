import { resolveProbesPerFrame } from '../../../../../sdk-core/src/bounce/contracts.ts'
import type { SceneProxy } from '../../../../../sdk-core/src/contracts/proxy.ts'
import type { BounceFrameMetrics } from '../../../../../sdk-core/src/contracts/shadowMetrics.ts'
import type { BounceCensus } from '../../../lighting/bounce/census.ts'
import type { GpuBounceProbes } from '../../../lighting/bounce/probes/probes.ts'

/**
 * State of bouncing light: the probe grid, what the host asked of it, and what the last image
 * actually did. Nothing is allocated per image.
 */
export interface WebgpuBounceState {
  probes: GpuBounceProbes | undefined
  /** The scene's proxy as the cache object carried it, once read: its sizes are published. */
  proxy: SceneProxy | undefined
  /** In-flight load of the resident proxy; it is launched only once, at the first light. */
  pending: Promise<unknown> | undefined
  /** What the host asked. */
  wanted: boolean
  /** The probes an image traces, those never traced first (`resolveProbesPerFrame`). */
  probesPerFrame: number
  /** The GPU duration of the bounce stage in the last timed image, in milliseconds: a measure, nothing
   *  steers by it; null until one was timed. */
  passMs: number | null
  /** Why bounce does not exist, when it does not. */
  reason: string | null
  /** Light-store revision already seen: a change restarts convergence. */
  lightEpoch: number
  /** Builds of the sky by direction already seen (`AtmosphereGpu.skyBuilds`): a new one restarts it too. */
  skyBuilds: number
  /** Scene revision the probes last followed the placements at, -1 before any
   *  (`../../prepare/bounce.ts`, `syncLightingProxies`). */
  sceneEpoch: number
  /** Probes updated and rays launched by the last image; zero when nothing was encoded. */
  probesUpdated: number
  raysLaunched: number
  /** True when the last image actually encoded the probe pass. */
  encoded: boolean
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
    liveProbes: probes ? probes.pool.live : null,
    // Probes alive that still hold nothing: zero says the light the image reads is filled.
    unfilledProbes: probes ? probes.unfilled : null,
    refusedMarks: probes ? probes.pool.refused : null,
    marksRead: probes ? probes.marked.reads : null,
    cellsMarked: probes ? probes.marked.cells : null,
    probesUpdated: bounce.probesUpdated,
    rays: bounce.raysLaunched,
    passMs: probes ? bounce.passMs : null,
    converged: probes ? !probes.working : null,
    rayReach: probes?.cascades.reach ?? null,
  }
}

/** What the last census of the field that came back counted (`lighting/bounce/census.ts`): none
 *  before the first. */
function censusState(counted: BounceCensus | undefined) {
  return {
    censusReads: counted?.reads ?? null,
    publishedSlots: counted?.publishedSlots ?? null,
    nonZeroProbes: counted?.litProbes ?? null,
    darkProbes: counted?.darkProbes ?? null,
    buriedProbes: counted?.buriedProbes ?? null,
    probesFiredTotal: counted?.updated ?? null,
    raysFired: counted?.fired ?? null,
    raysAnswered: counted?.answered ?? null,
    raysLit: counted?.lit ?? null,
    raysMarked: counted?.marked ?? null,
    probesWrittenTotal: counted?.written ?? null,
    probesBuriedTotal: counted?.buried ?? null,
    raysLostBy: counted?.lostBy ?? null,
    rayWork: counted?.work ?? null,
  }
}

/** Bounce state, as the image diagnostics, the frame's metrics and the per-stage profile publish it:
 *  the CPU's counts of the image just drawn, and the last census of the field the GPU counted. */
export function bounceState(bounce: WebgpuBounceState): BounceFrameMetrics {
  return { ...rigState(bounce), ...censusState(bounce.probes?.counted()) }
}

export function createWebgpuBounceState(
  wanted: boolean,
  probesPerFrame?: number,
): WebgpuBounceState {
  return {
    probes: undefined,
    proxy: undefined,
    pending: undefined,
    wanted,
    probesPerFrame: resolveProbesPerFrame(probesPerFrame),
    passMs: null,
    reason: null,
    lightEpoch: 0,
    skyBuilds: 0,
    sceneEpoch: -1,
    probesUpdated: 0,
    raysLaunched: 0,
    encoded: false,
    firstFrameLogged: false,
  }
}
