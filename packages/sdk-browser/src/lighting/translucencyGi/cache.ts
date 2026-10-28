import type { BounceShape } from '../../../../sdk-core/src/bounce/contracts.ts'
import type { ScreenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { TranslucencyGiValues } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { WebgpuBounceState } from '../../frame/backend/state/bounce.ts'
import { createMarkSurface } from '../bounce/pool/pool.ts'
import {
  encodeHeldProbes,
  idleExpired,
  startHeldProbes,
  type ProbeFrame,
  type ProbeHold,
} from '../bounce/probes/hold.ts'
import { screenProbeSettingsOf } from '../bounce/screen/settingsOf.ts'
import { translucencyGiEndDistanceOf, translucencyGiSettings, wanted } from './settings.ts'
import { translucencyGiMarkers } from './marker.ts'
import {
  clipmapsCovering,
  translucencyCacheSettings,
  translucencyCacheShape,
} from './cacheShape.ts'

/** Whether the volume reads a cache of its own this image: it is made, reads a radiance cache and does not share the world's. */
const ownCacheWanted = (rt: WebgpuPagesRuntime, v: TranslucencyGiValues) =>
  v.translucencyGiRadianceCache && !v.translucencyGiShareRadianceCacheWithOpaque && wanted(rt, v)

/** What the volume keeps of its own cache between two images; its pool is marked from the cells' mark alone, no image surface. */
export interface TranslucencyCacheHold extends ProbeHold {
  /** The screen probes' settings object and the numbers (`INPUTS`) `shape`, `shapeKey` and `settings` were made from: made again when one moved. */
  readonly followed: { screen: ScreenProbeSettings | undefined; inputs: Float64Array }
}

/** The numbers the cache's shape and settings are made of, in the order `inputsOf` writes them. */
const INPUTS = 9

const newHold = (): TranslucencyCacheHold => ({
  probes: undefined,
  key: undefined,
  idle: 0,
  followed: { screen: undefined, inputs: new Float64Array(INPUTS) },
  shape: undefined,
  shapeKey: undefined,
  settings: undefined,
  surface: createMarkSurface(),
})

/** The hold, made where there is none. */
const translucencyCacheHold = (bounce: WebgpuBounceState) => (bounce.translucency ??= newHold())

/** The numbers the cache's shape and settings are made of, written into `out`. */
function inputsOf(out: Float64Array, v: TranslucencyGiValues, end: number) {
  out[0] = clipmapsCovering(
    end,
    v.translucencyGiRadianceCacheClipmapWorldExtent,
    v.translucencyGiRadianceCacheClipmapDistributionBase,
  )
  out[1] = v.translucencyGiRadianceCacheGridResolution
  out[2] = v.translucencyGiRadianceCacheClipmapWorldExtent
  out[3] = v.translucencyGiRadianceCacheClipmapDistributionBase
  out[4] = v.translucencyGiRadianceCacheProbeAtlasResolutionInProbes
  out[5] = v.translucencyGiRadianceCacheProbeResolution
  out[6] = v.translucencyGiRadianceCacheNumMipmaps
  out[7] = v.translucencyGiRadianceCacheNumProbesToTraceBudget
  out[8] = v.translucencyGiTraceFromVolume ? 1 : 0
}

const SCRATCH = new Float64Array(INPUTS)

/** The shape, its key and the settings of the cache for these settings, made again only when an input moved. */
function followSettings(
  hold: TranslucencyCacheHold,
  screen: ScreenProbeSettings,
  v: TranslucencyGiValues,
  end: number,
) {
  const { followed } = hold
  inputsOf(SCRATCH, v, end)
  if (
    hold.settings &&
    followed.screen === screen &&
    SCRATCH.every((x, k) => x === followed.inputs[k])
  )
    return
  followed.screen = screen
  followed.inputs.set(SCRATCH)
  const shape = translucencyCacheShape(v, end)
  hold.shape = shape
  hold.shapeKey = keyOf(shape)
  hold.settings = translucencyCacheSettings(screen, v)
}

/** The shape's key: what the levels and the pool are made of, which the probes cannot follow without being made again. */
const keyOf = (shape: BounceShape) =>
  [
    shape.cascadeLevels,
    shape.cascadeSize,
    shape.cascadeHalfExtentMetres,
    shape.cascadeBase,
    shape.probePool,
  ].join(':')

/** The probes given back, and any being made forgotten (the making ends with `hold.key` changed). */
function drop(hold: TranslucencyCacheHold) {
  hold.probes?.dispose()
  hold.probes = hold.key = undefined
}

/** The cache given back, now. */
export function releaseTranslucencyCache(bounce: WebgpuBounceState) {
  if (bounce.translucency) drop(bounce.translucency)
}

/**
 * The probe pass of the volume's own cache, with the world's (the cells it marks are marked against this image's depth, as the world's are):
 * its levels follow the eye, the cells the volume marked last image (the mark alone: no image surface marks here) take probes, and the maps
 * of the probes queued are traced after (`flushTranslucencyCache`). Made again, off the frame, when the volume's settings changed its shape;
 * given back after `KEEP_IMAGES` images the volume did not want it. A great change of the lighting (`bounce.historyLost`) discards what it
 * holds; a change of the lights restarts its series (`restartTranslucencyCache`).
 */
export function encodeTranslucencyCache(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  frame: ProbeFrame,
) {
  const { bounce, lights } = rt
  const device = rt.gpu.device
  if (!device) return
  const v = translucencyGiSettings(rt)
  const hold = translucencyCacheHold(bounce)
  if (!ownCacheWanted(rt, v)) {
    if (idleExpired(hold)) drop(hold)
    return
  }
  hold.idle = 0
  followSettings(hold, screenProbeSettingsOf(rt), v, translucencyGiEndDistanceOf(rt, v))
  const key = hold.shapeKey!
  if (hold.key !== key) {
    drop(hold)
    // The levels follow the eye before anything reads them; the world's moves of the placements restart them
    // (`restartTranslucencyCache`) instead of a read of their own.
    if (lights.buffer)
      startHeldProbes(
        rt,
        device,
        hold,
        key,
        { surfaceMarks: false },
        'translucency-cache-unavailable',
      )
  }
  if (!hold.probes) return
  hold.surface.markers = translucencyGiMarkers(rt, 'own')
  encodeHeldProbes(rt, encoder, hold.probes, hold.surface, frame)
}

/** The maps of the probes the volume's cache queued this image traced, in a pass of their own, before the volume reads them. */
export function flushTranslucencyCache(bounce: WebgpuBounceState, encoder: GPUCommandEncoder) {
  bounce.translucency?.probes?.cache.flush(encoder)
}

/** The world's placements moved or arrived: the volume's cache holds the light of a scene that was. */
export function restartTranslucencyCache(bounce: WebgpuBounceState) {
  bounce.translucency?.probes?.restart()
}

/** How the trace reads the cache of this image (`TranslucencyGiFrame.cache`): the radius scale of the sphere a map is read through, the maps'
 *  side, their levels of detail and whether the sky is kept apart. */
export interface CacheRead {
  radiusScale: number
  resolution: number
  mipmaps: number
  sky: boolean
}

/** What the trace reads of the cache: the volume's own settings where the cache is its own, the screen probes' where shared. */
export function cacheReadOf(
  out: CacheRead,
  rt: WebgpuPagesRuntime,
  v: TranslucencyGiValues,
): CacheRead {
  if (v.translucencyGiShareRadianceCacheWithOpaque) {
    const screen = screenProbeSettingsOf(rt)
    out.radiusScale = screen.values.screenProbeRadianceCacheReprojectionRadiusScale
    out.resolution = screen.cache.resolution
    out.mipmaps = screen.cache.mipmaps
    out.sky = screen.cache.skyVisibility
  } else {
    out.radiusScale = v.translucencyGiRadianceCacheReprojectionRadiusScale
    out.resolution = v.translucencyGiRadianceCacheProbeResolution
    out.mipmaps = v.translucencyGiRadianceCacheNumMipmaps
    out.sky = false
  }
  return out
}
