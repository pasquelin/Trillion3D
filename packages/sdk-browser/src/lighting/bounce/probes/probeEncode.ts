import type { BounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { probeQueueShapeOf } from '../../../../../sdk-core/src/bounce/contracts.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { BOUNCE_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { SurfaceHitReads } from '../../surfaceCache/hitWgsl.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import type { RadianceCache } from '../cache/radianceCache.ts'
import type { BouncePool, MarkSurface, PoolWork } from '../pool/pool.ts'
import type { createBounceUniform } from '../uniform.ts'
import type { PlacementBoxes } from '../../../geometry/dag/placement/placementBoxes.ts'
import type { SkyLightReadSet } from '../../../modules/sky/skyLight/read.ts'

/** What the probes read of the scene's placements (`geometry/dag/placement/placementBoxes.ts`, through the selection): their extent, the
 *  levels first centred on it, and the moves that restart the series. The rays march the global distance field, or are cast through the
 *  scene's triangles where the image has the scene trace. */
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

/** The bounce pass of an image: the pool's work — the cells it reads marked, the probes given and taken back, the ones to trace chosen
 *  and the queue and the table written. The probes queued are the GPU's to count: every dispatch over them takes the arguments the pool wrote.
 *  Returns the block of probes the queue is laid in, and whether the pass is a full update. */
function encodePass(
  parts: ProbeParts,
  encoder: GPUCommandEncoder,
  surface: MarkSurface | undefined,
  work: PoolWork,
  atlasDownsample: number,
) {
  const { pool, cascades } = parts
  const full = pool.full
  const queue = probeQueueShapeOf(work.probesPerFrame, atlasDownsample, full, cascades.probes)
  work.queueProbes = queue.probes
  pool.clear(encoder)
  pool.markTranslucent(encoder, work.translucent, surface)
  const pass = encoder.beginComputePass({ label: BOUNCE_PASS })
  pool.dispatch(pass, work, surface)
  pass.end()
  pool.copy(encoder)
  return { ...queue, full }
}

/** A pool's work before the first image fills it. */
function newWork(): PoolWork {
  return {
    probesPerFrame: 0,
    queueProbes: 0,
    keepFrames: 0,
    markDownsample: 1,
    interpolateDownsample: 1,
    downsampleSq: 0,
    supersampleSq: 0,
    translucent: undefined,
  }
}

/** The pool's work of an image, from the radiance cache's settings. */
function fillWork(work: PoolWork, cache: ScreenProbeSettings['cache']) {
  work.probesPerFrame = cache.budget
  work.keepFrames = cache.framesToKeepProbes
  work.markDownsample = cache.markDownsample
  work.interpolateDownsample = cache.interpolateDownsample
  work.downsampleSq = cache.downsampleSq
  work.supersampleSq = cache.supersampleSq
  work.translucent = cache.translucentMark
}

/** What the radiance cache reads of the image besides the probes' queue: the lights, the sky light, the surface cache's reads, the eye, the scene's rays and the pre-exposure. */
interface QueuedInputs {
  lights: GPUBuffer
  sky: SkyLightReadSet
  reads: SurfaceHitReads
  eye: ArrayLike<number>
  rays: SceneRays | undefined
  preExposure: number
}

/** Encodes the pass of an image of probes and hands its queue to the radiance cache; nothing while the cache is frozen (it keeps its probes and its maps as they are).
 *  Asked for in full, every image gives every probe back. */
function queueImage(
  parts: ProbeParts,
  now: ScreenProbeSettings,
  work: ReturnType<typeof newWork>,
  encoder: GPUCommandEncoder,
  surface: MarkSurface | undefined,
  inputs: QueuedInputs,
) {
  if (!now.values.screenProbeRadianceCacheUpdate) return
  if (now.values.screenProbeRadianceCacheForceFullUpdate) {
    // The maps are sized for `now` before they are cleared (`queued` follows again, with nothing left to change).
    parts.cache.follow(now, inputs.preExposure)
    parts.cache.clear(encoder)
    parts.pool.discard()
  }
  const queue = encodePass(parts, encoder, surface, work, now.cache.temporaryAtlasDownsample)
  parts.cache.queued(now, { args: parts.pool.args, ...inputs, queue })
}

/**
 * The encoding of an image of probes: its marks and a probe batch, whose maps the radiance cache makes after, and what the series says
 * of itself. `frame` counts the images that encoded something, the clock of the pool.
 */
export function createProbeEncoder(
  parts: ProbeParts,
  lights: () => GPUBuffer,
  /** The screen probes' settings, which the radiance cache follows: read at each image. */
  settings: () => ScreenProbeSettings,
) {
  const { cascades, pool } = parts
  let frame = 0
  /** The work of the image in hand, refilled each image. */
  const work = newWork()
  return {
    /** The lights changed, or the placements, or the maps of the radiance cache were made again: the series is open till every probe is
     *  traced since. */
    restart: pool.restart,
    /** The maps of the radiance cache were made again, or the lighting changed by a great deal: the next pass is a full update (`pool.discard`). */
    discard: pool.discard,
    /** The series is open: a probe holding nothing or not traced since the last change, or statistics still to come back. */
    get working() {
      return pool.working
    },
    /** The levels re-centred on the image's viewpoint, before anything reads them this image. */
    follow(viewpoint: ArrayLike<number>) {
      cascades.follow(viewpoint)
    },
    /** Encodes an image's marks (`surface`: what it drew) and a probe batch, whose maps the radiance cache traces through the global
     *  distance field — or, where the image made the scene trace (`rays`), through the scene's triangles —, its hits reading the
     *  surface cache (`reads`), those that leave the scene reaching the sky light (`sky`), the light kept under the pre-exposure
     *  `preExposure` (`cachedLightingPreExposureOf`). Under an orthographic view, `forward` is the
     *  direction it looks along, which a probe's distance to the camera is measured along (`cameraDistanceSq`). */
    encode(
      encoder: GPUCommandEncoder,
      viewpoint: ArrayLike<number>,
      sky: SkyLightReadSet,
      reads: SurfaceHitReads,
      preExposure: number,
      surface?: MarkSurface,
      rays?: SceneRays,
      forward?: ArrayLike<number>,
    ) {
      const now = settings()
      frame++
      fillWork(work, now.cache)
      parts.uniform.write(
        frame,
        viewpoint,
        now.values.screenProbeMaxTraceDistance,
        now.cache.minTraceScale,
        preExposure,
        forward,
      )
      queueImage(parts, now, work, encoder, surface, {
        lights: lights(),
        sky,
        reads,
        eye: viewpoint,
        rays,
        preExposure,
      })
    },
  }
}
