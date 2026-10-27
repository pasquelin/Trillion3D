import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { IRRADIANCE_PROBE_SIDE } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { listBytes } from '../../../gpu/dispatch/list.ts'
import { countingAllocator, type ResourceAllocator } from '../../../gpu/core/resourceAllocator.ts'
import {
  INTEGRATE_TILE_ARGS_WORDS,
  PDF_LOBE_WORDS,
  SCENE_RAY_WORDS,
  SCREEN_PROBE_ARGS,
  SCREEN_PROBE_FORMATS as F,
  SCREEN_PROBE_PARAMS_BYTES,
  type ScreenProbeGeometry,
  gatherMipSide,
  integrateTiles,
} from './screenProbeLayout.ts'

/** A pair of views taken in turn, one frame's and the next's. */
type Turn<T> = readonly [T, T]

/** Texels along each axis of the irradiance texture: nine to a probe in a row of harmonics, or the octahedral
 *  map's square with its border, which the harmonics share (their first nine texels) where the probes keep an extra ambient occlusion: its alpha holds the occlusion by normal. */
function irradianceSize(geometry: ScreenProbeGeometry, bordered: boolean): [number, number] {
  const border = IRRADIANCE_PROBE_SIDE + 2
  return bordered
    ? [geometry.tilesX * border, geometry.rows * border]
    : [geometry.tilesX * 9, geometry.rows]
}

/** The settings that shape the probes' textures: the irradiance's format, the texture of what the temporal filter of the probes keeps, of the extra ambient
 *  occlusion and the levels of detail the gather holds. */
type ProbeSettings = Pick<
  ScreenProbeSettings,
  'irradianceFormat' | 'temporalFilterProbes' | 'extraAo' | 'gatherMips'
>

/** The textures of the probes: their records (this image's and the last's, whose depths and light the importance
 *  sampling reads), the rays, the trace's radiance and ends (read and written in place, stage after stage), the
 *  gathered radiance — the filter's passes taking turns, the last image's final one kept —, the irradiance (with the extra ambient occlusion by normal in its alpha where
 *  the probes keep one), and, where the settings ask them,
 *  the composited radiance this image and the last (the temporal filter of the probes), the extra ambient occlusion by direction (the filter's passes
 *  taking turns), and the levels of the gathered radiance with their border. What a setting leaves off is a texel, or none. */
function probeTextures(a: ResourceAllocator, g: ScreenProbeGeometry, settings: ProbeSettings) {
  const probes: [number, number] = [g.tilesX, g.rows]
  const traced: [number, number] = [g.tilesX * g.tracing, g.rows * g.tracing]
  const gathered: [number, number] = [g.tilesX * g.gather, g.rows * g.gather]
  const where = (on: boolean, size: [number, number]): [number, number] => (on ? size : [1, 1])
  const pair = <T>(make: (side: number) => T): Turn<T> => [make(0), make(1)]
  return {
    info: pair((side) => a.texture(`probes ${side}`, probes, F.info)),
    normal: a.texture('normals', probes, F.normal),
    ray: a.texture('rays', traced, F.ray),
    radiance: a.texture('trace radiance', traced, F.trace),
    hit: a.texture('trace ends', traced, F.hit),
    probeHistory: pair((side) =>
      a.texture(
        `probe radiance history ${side}`,
        where(settings.temporalFilterProbes, gathered),
        F.gather,
      ),
    ),
    gather: pair((side) => a.texture(`gather ${side}`, gathered, F.gather)),
    extraAo: pair((side) =>
      a.texture(`extra ambient occlusion ${side}`, where(settings.extraAo, gathered), F.extraAo),
    ),
    // The levels of the gathered radiance with their border, one texture of `gatherMips` levels (`gatherMipSide`, the first the gather's own): a view of
    // all of them to read and a view of each to write; none where the gather holds one level.
    mips:
      settings.gatherMips > 1
        ? a.mipped(
            'gather levels',
            [
              g.tilesX * gatherMipSide(g.gather, settings.gatherMips, 0),
              g.rows * gatherMipSide(g.gather, settings.gatherMips, 0),
            ],
            F.radianceMip,
            settings.gatherMips,
          )
        : undefined,
    irradiance: a.texture(
      'irradiance',
      irradianceSize(g, settings.irradianceFormat === 'octahedral' || settings.extraAo),
      F.irradiance,
    ),
  }
}

/** The settings that shape the textures of the pixels. */
type PixelSettings = Pick<
  ScreenProbeSettings,
  'occlusionDownsample' | 'integrateDownsample' | 'bentNormal'
>

/** The textures of the pixels: the history's words, the shading and the depth it was found at, what the integration leaves for the temporal pass (the light, the
 *  rough specular and the back, a texel for each pixel the integration runs at: one in `integrateDownsample` along each side), where the temporal pass reads them
 *  from (`offsets`, a pixel each, where the integration is downsampled), the occlusion (with the bent normal where the level keeps it). */
function pixelTextures(
  a: ResourceAllocator,
  { width, height }: ScreenProbeGeometry,
  settings: PixelSettings,
) {
  const downsample = settings.occlusionDownsample
  const integrated: [number, number] = [
    ceilDiv(width, settings.integrateDownsample),
    ceilDiv(height, settings.integrateDownsample),
  ]
  const pair = <T>(make: (side: number) => T): Turn<T> => [make(0), make(1)]
  return {
    history: pair((side) => a.texture(`history ${side}`, [width, height], F.history)),
    shading: pair((side) => a.texture(`history shading ${side}`, [width, height], F.shading)),
    keptDepth: pair((side) => a.texture(`history depth ${side}`, [width, height], F.keptDepth)),
    light: a.texture('integrated light', integrated, F.light),
    rough: a.texture('integrated rough specular', integrated, F.rough),
    back: a.texture('integrated back', integrated, F.back),
    offsets: a.texture(
      'integration offsets',
      settings.integrateDownsample > 1 ? [width, height] : [1, 1],
      F.offsets,
    ),
    occlusion: a.texture(
      'occlusion',
      [ceilDiv(width, downsample), ceilDiv(height, downsample)],
      settings.bentNormal ? F.bentOcclusion : F.occlusion,
    ),
  }
}

/**
 * What a view's screen probes keep, at the sizes of `capacity` (`screenProbeGeometry`, of the size the view's targets are made at):
 * the probes' records, the rays' words, the trace's radiance and ends, the gathered radiance, the probes' irradiance, the pixels'
 * history (with the shading and depth it was found at), what the integration leaves them, and the occlusion; and the buffers: each probe's pixel, its cosine lobes, whether it is disoccluded, its share of
 * rays that move, the placement's mask, counts and lists, the list of the rays the screen left to the scene (and the head that
 * empties it), the indirect arguments of the kernels over the probes in use, the tiles of pixels each integration is dispatched over (and their arguments). All written by compute passes, so every texture is a
 * storage texture and a sampled one.
 */
export function createScreenProbeResources(
  a: ResourceAllocator,
  capacity: ScreenProbeGeometry,
  settings: ProbeSettings & PixelSettings,
) {
  const { tilesX, tilesY, uniform, maxAdaptive, samplesX, samplesY, tracing } = capacity
  const maxProbes = uniform + maxAdaptive
  const rays = maxProbes * tracing * tracing
  const storage = (label: string, words: number) => a.buffer(label, words, 'storage')
  return {
    geometry: capacity,
    params: a.buffer('parameters', SCREEN_PROBE_PARAMS_BYTES / 4, 'uniform'),
    ...probeTextures(a, capacity, settings),
    ...pixelTextures(a, capacity, settings),
    pixels: storage('probe pixels', maxProbes),
    brdf: storage('cosine lobes', maxProbes * PDF_LOBE_WORDS),
    disocclusion: storage('disocclusion', maxProbes),
    moving: storage('probe moving', maxProbes),
    mask: storage('placement mask', tilesX * tilesY),
    header: storage('tile counts', tilesX * tilesY),
    indices: storage('tile lists', tilesX * tilesY * samplesX * samplesY),
    counts: storage('adaptive count', 1),
    args: a.buffer('arguments', SCREEN_PROBE_ARGS.words, 'args'),
    tileList: storage(
      'integrate tiles',
      2 * integrateTiles(capacity, settings.integrateDownsample),
    ),
    tileArgs: a.buffer('integrate tile arguments', INTEGRATE_TILE_ARGS_WORDS, 'args'),
    sceneRays: a.buffer('scene rays', listBytes(rays, SCENE_RAY_WORDS) / 4, 'list'),
    listHead: a.buffer('scene rays head', 4, 'head'),
  }
}

/** The resources of a view, made. */
export type ScreenProbeResources = ReturnType<typeof createScreenProbeResources>

/** Bytes the resources of a view of `capacity` and `settings` would hold. */
export function screenProbeBytes(
  capacity: ScreenProbeGeometry,
  settings: ProbeSettings & PixelSettings,
) {
  const counting = countingAllocator()
  createScreenProbeResources(counting, capacity, settings)
  return counting.bytes()
}
