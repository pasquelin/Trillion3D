import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { IRRADIANCE_PROBE_SIDE } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { listBytes } from '../../../gpu/dispatch/list.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import {
  SCENE_RAY_WORDS,
  SCREEN_PROBE_ARGS,
  SCREEN_PROBE_FORMATS as F,
  SCREEN_PROBE_PARAMS_BYTES,
  type ScreenProbeGeometry,
} from './screenProbeLayout.ts'

/** A pair of views taken in turn, one frame's and the next's. */
export type Turn<T> = readonly [T, T]

/** What a buffer is for: written by the kernels and the host (`storage`), the uniform, the indirect arguments the kernels
 *  write, a list the kernels fill and dispatches are made over, and the head that empties it. */
type BufferKind = 'storage' | 'uniform' | 'args' | 'list' | 'head'

/** Where the resources of a view come from: GPU objects (`gpuAllocator`), or none, counting what they would hold
 *  (`countingAllocator`), so that the bytes a view asks are known before any is made. */
export interface ProbeAllocator {
  texture(label: string, size: [number, number], format: GPUTextureFormat): GPUTextureView
  buffer(label: string, words: number, kind: BufferKind): GPUBuffer
}

/** The usage of a buffer of `kind`. */
const usageOf = (kind: BufferKind) => {
  const { STORAGE, UNIFORM, INDIRECT, COPY_DST, COPY_SRC } = GPUBufferUsage
  if (kind === 'uniform') return UNIFORM | COPY_DST
  if (kind === 'args') return STORAGE | INDIRECT
  if (kind === 'list') return STORAGE | INDIRECT | COPY_DST
  if (kind === 'head') return COPY_SRC | COPY_DST
  return STORAGE | COPY_DST
}

/** The allocator over `device`: textures that are storage and sampled, buffers as asked, all counted and kept to be destroyed together. */
export function gpuAllocator(device: GPUDevice) {
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
  const made: { destroy(): void }[] = []
  let bytes = 0
  return {
    texture(label: string, size: [number, number], format: GPUTextureFormat) {
      const created = device.createTexture({
        label: `Trillion3D screen probes ${label}`,
        size,
        format,
        usage,
      })
      made.push(created)
      bytes += textureBytesOf({ size, format }) ?? 0
      return created.createView()
    },
    buffer(label: string, words: number, kind: BufferKind) {
      const size = Math.max(16, words * 4)
      const created = device.createBuffer({
        label: `Trillion3D screen probes ${label}`,
        size,
        usage: usageOf(kind),
      })
      made.push(created)
      bytes += size
      return created
    },
    /** Bytes of all that was made. */
    bytes: () => bytes,
    destroy() {
      for (const resource of made) resource.destroy()
    },
  }
}

/** The allocator that makes nothing and counts what it is asked. */
export function countingAllocator() {
  let bytes = 0
  return {
    texture(_label: string, size: [number, number], format: GPUTextureFormat) {
      bytes += textureBytesOf({ size, format }) ?? 0
      return undefined as unknown as GPUTextureView
    },
    buffer(_label: string, words: number) {
      bytes += Math.max(16, words * 4)
      return undefined as unknown as GPUBuffer
    },
    bytes: () => bytes,
  }
}

/** Texels along each axis of the irradiance texture: nine to a probe in a row of harmonics, or the octahedral
 *  map's square with its border. */
function irradianceSize(geometry: ScreenProbeGeometry, octahedral: boolean): [number, number] {
  const border = IRRADIANCE_PROBE_SIDE + 2
  return octahedral
    ? [geometry.tilesX * border, geometry.rows * border]
    : [geometry.tilesX * 9, geometry.rows]
}

/** The textures of the probes: their records (this image's and the last's, whose depths and light the importance
 *  sampling reads), the rays, the trace's radiance and ends (read and written in place, stage after stage), the
 *  gathered radiance — the filter's passes taking turns, the last image's final one kept — and the irradiance. */
function probeTextures(
  a: ProbeAllocator,
  g: ScreenProbeGeometry,
  settings: Pick<ScreenProbeSettings, 'irradianceFormat'>,
) {
  const probes: [number, number] = [g.tilesX, g.rows]
  const traced: [number, number] = [g.tilesX * g.tracing, g.rows * g.tracing]
  const gathered: [number, number] = [g.tilesX * g.gather, g.rows * g.gather]
  const pair = <T>(make: (side: number) => T): Turn<T> => [make(0), make(1)]
  return {
    info: pair((side) => a.texture(`probes ${side}`, probes, F.info)),
    normal: a.texture('normals', probes, F.normal),
    ray: a.texture('rays', traced, F.ray),
    radiance: a.texture('trace radiance', traced, F.trace),
    hit: a.texture('trace ends', traced, F.hit),
    gather: pair((side) => a.texture(`gather ${side}`, gathered, F.gather)),
    irradiance: a.texture(
      'irradiance',
      irradianceSize(g, settings.irradianceFormat === 'octahedral'),
      F.irradiance,
    ),
  }
}

/** The textures of the pixels: the history's pair of words, the occlusion. */
function pixelTextures(
  a: ProbeAllocator,
  { width, height }: ScreenProbeGeometry,
  settings: Pick<ScreenProbeSettings, 'occlusionDownsample'>,
) {
  const downsample = settings.occlusionDownsample
  const pair = <T>(make: (side: number) => T): Turn<T> => [make(0), make(1)]
  return {
    history: pair((side) => a.texture(`history ${side}`, [width, height], F.history)),
    occlusion: a.texture(
      'occlusion',
      [ceilDiv(width, downsample), ceilDiv(height, downsample)],
      F.occlusion,
    ),
  }
}

/**
 * What a view's screen probes keep, at the sizes of `capacity` (`screenProbeGeometry`, of the size the view's targets are made at):
 * the probes' records, the rays' words, the trace's radiance and ends, the gathered radiance, the probes' irradiance, the pixels'
 * history and the occlusion; and the buffers: each probe's pixel, its cosine lobes, whether it is disoccluded, its share of
 * rays that move, the placement's mask, counts and lists, the list of the rays the screen left to the scene (and the head that
 * empties it), the indirect arguments of the kernels over the probes in use. All written by compute passes, so every texture is a
 * storage texture and a sampled one.
 */
export function createScreenProbeResources(
  a: ProbeAllocator,
  capacity: ScreenProbeGeometry,
  settings: Pick<ScreenProbeSettings, 'irradianceFormat' | 'occlusionDownsample'>,
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
    brdf: storage('cosine lobes', maxProbes * 9),
    disocclusion: storage('disocclusion', maxProbes),
    moving: storage('probe moving', maxProbes),
    mask: storage('placement mask', tilesX * tilesY),
    header: storage('tile counts', tilesX * tilesY),
    indices: storage('tile lists', tilesX * tilesY * samplesX * samplesY),
    counts: storage('adaptive count', 1),
    args: a.buffer('arguments', SCREEN_PROBE_ARGS.words, 'args'),
    sceneRays: a.buffer('scene rays', listBytes(rays, SCENE_RAY_WORDS) / 4, 'list'),
    listHead: a.buffer('scene rays head', 4, 'head'),
  }
}

/** The resources of a view, made. */
export type ScreenProbeResources = ReturnType<typeof createScreenProbeResources>

/** Bytes the resources of a view of `capacity` and `settings` would hold. */
export function screenProbeBytes(
  capacity: ScreenProbeGeometry,
  settings: Pick<ScreenProbeSettings, 'irradianceFormat' | 'occlusionDownsample'>,
) {
  const counting = countingAllocator()
  createScreenProbeResources(counting, capacity, settings)
  return counting.bytes()
}
