import type { BounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { BOUNCE_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { SurfaceHitReads } from '../../surfaceCache/hitWgsl.ts'
import type { RadianceCache } from '../cache/radianceCache.ts'
import type { BouncePool, MarkSurface } from '../pool/pool.ts'
import type { createBounceUniform } from '../uniform.ts'
import type { PlacementBoxes } from '../../../geometry/dag/placement/placementBoxes.ts'
import type { SkyLightReadSet } from '../../../modules/sky/skyLight/read.ts'

/** What the probes read of the scene's placements (`geometry/dag/placement/placementBoxes.ts`, through the selection): their extent,
 *  which the rays' reach is laid on. The rays march the global distance field. */
export type ProbeScene = {
  boxes(): PlacementBoxes
}

/** What the encoding of an image works with: the levels, the pool, the levels' uniform and the radiance cache. */
export type ProbeParts = {
  cascades: BounceCascades
  pool: BouncePool
  uniform: ReturnType<typeof createBounceUniform>
  /** The radiance cache: the maps of the probes queued, made after the pass (`../cache/radianceCache.ts`). */
  cache: RadianceCache
}

/** The work of an image: whether it marks and whether the levels slid. */
type Work = {
  marking: boolean
  slid: boolean
}

/** What the pool is asked to trace an image: the budget, in probes' cost, and the squares of the distances from the eye at which the
 *  cost of a probe changes, as the screen probes' settings give them. */
type PoolBudget = { probesPerFrame: number; downsampleSq: number; supersampleSq: number }

/** The bounce pass of an image: the pool's work — the cells it reads marked, the probes given and taken back, the ones to trace chosen
 *  and the queue and the table written. The probes queued are the GPU's to count: every dispatch over them takes the arguments the pool wrote. */
function encodePass(
  parts: ProbeParts,
  encoder: GPUCommandEncoder,
  surface: MarkSurface | undefined,
  work: Work,
  budget: PoolBudget,
) {
  const { pool } = parts
  pool.clear(encoder, work)
  const pass = encoder.beginComputePass({ label: BOUNCE_PASS })
  pool.dispatch(pass, { ...work, ...budget }, surface)
  pass.end()
  pool.copy(encoder)
}

/**
 * The encoding of an image of probes: its marks and a probe batch, whose maps the radiance cache makes after, and what the series says
 * of itself. `frame` counts the images that encoded something, the clock of the pool.
 */
export function createProbeEncoder(
  parts: ProbeParts,
  lights: () => GPUBuffer,
  /** The probes an image traces, in the cost of a whole map each: read at each image. */
  probesPerFrame: () => number,
  /** The screen probes' settings, which the radiance cache follows: read at each image. */
  settings: () => ScreenProbeSettings,
) {
  const { cascades, pool } = parts
  let frame = 0
  const budget: PoolBudget = { probesPerFrame: 0, downsampleSq: 0, supersampleSq: 0 }
  /** The work of the image in hand, refilled each image. */
  const work: Work = { marking: false, slid: false }
  return {
    /** Every probe is traced again: the maps of the radiance cache were made again. */
    retrace: pool.restart,
    /** A light changed, or the placements: every probe is traced again, and the cells the image reads are marked again. */
    restart() {
      pool.restart()
      pool.stale()
    },
    /** The series is open: a probe holding nothing or short of its traces, a mark owed or statistics still to come back. */
    get working() {
      return pool.working
    },
    /** The levels re-centred on the image's viewpoint, before anything reads them this image: whether they slid. */
    follow(viewpoint: ArrayLike<number>) {
      work.slid = cascades.follow(viewpoint)
    },
    /** Encodes an image's marks (`surface`: what it drew) and a probe batch, whose maps the radiance cache traces through the global
     *  distance field, its hits reading the surface cache (`reads`), those that leave the scene reaching the sky light (`sky`); `false`
     *  when there was nothing to do: the view still and marked, the series closed, no light. */
    encode(
      encoder: GPUCommandEncoder,
      lightsActive: number,
      viewpoint: ArrayLike<number>,
      sky: SkyLightReadSet,
      reads: SurfaceHitReads,
      surface?: MarkSurface,
    ) {
      if (!lightsActive) return false
      work.marking = pool.begin(surface, work.slid)
      if (!work.marking && !work.slid && !pool.working) return false
      const now = settings()
      frame++
      budget.probesPerFrame = probesPerFrame()
      budget.downsampleSq = now.cache.downsampleSq
      budget.supersampleSq = now.cache.supersampleSq
      parts.uniform.write(frame, viewpoint)
      encodePass(parts, encoder, surface, work, budget)
      parts.cache.queued(now, { args: pool.args, lights: lights(), sky, reads, eye: viewpoint })
      return true
    },
  }
}
