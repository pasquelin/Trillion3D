import { retire } from '../../gpu/core/frameRetire.ts'
import type { FogRead } from '../../lighting/fog/read.ts'
import type { LocalFogTiling } from '../../lighting/fog/localTiling.ts'
import type { WebgpuGpuState } from '../backend/state/gpu.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * What a view holds for the lists of the local fog volumes (`../../lighting/fog/localCullWgsl.ts`): the
 * buffer they are written into, made for the tile grid of the image and only while a view draws a
 * volume, and the fog's resources the programs bind, composed with it.
 */
export interface LocalFogGpu {
  /** The buffer of the lists, none while no volume is drawn. */
  tiles: GPUBuffer | undefined
  /** The fog's resources composed with the lists' buffer: the object last handed out, and what it
   *  was made of, so that the programs keep their groups while neither changed. */
  composed?: { base: FogRead; tiles: GPUBuffer; read: FogRead }
  /** The words last said too large for a binding, so that a size is said once. */
  saidTooLarge: number
  /** What this image's volumes are, set when they are published (`prepareLocalFog`) and taken by the
   *  passes that follow: how many volumes the view draws (`count`, none before an image draws one, the one
   *  count the passes follow), and — while `active`, the lists made — the tiling and whether the depth
   *  pyramid culls. One object, rewritten each image. */
  readonly plan: { active: boolean; count: number; tiling: LocalFogTiling; pyramid: boolean }
}

/** The state the view holds for the lists, made at the first image that needs it. */
export const localFogGpuOf = (gpu: Pick<WebgpuGpuState, 'localFog'>): LocalFogGpu =>
  (gpu.localFog ??= {
    tiles: undefined,
    saidTooLarge: 0,
    plan: {
      active: false,
      count: 0,
      tiling: { size: 0, across: 0, down: 0, stride: 0, words: 0 },
      pyramid: false,
    },
  })

/** Bytes of the buffer of the lists. */
export const localFogBytes = (gpu: Pick<WebgpuGpuState, 'localFog'>) =>
  gpu.localFog?.tiles?.size ?? 0

/**
 * The buffer of the lists for `words` words: kept while it holds them and is not more than twice what
 * they need (the programs accept a larger buffer than the grid asks, `localFogTiled`), so that a
 * resize or a finer tile side within that range does not make the groups that name it again; else
 * made for them. A buffer still read by a pass in flight is released with it (`GPUBuffer.destroy`).
 */
export function useLocalFogTiles(
  device: GPUDevice,
  gpu: Pick<WebgpuGpuState, 'localFog'>,
  words: number,
) {
  const held = localFogGpuOf(gpu)
  const bytes = words * 4
  const size = held.tiles?.size ?? 0
  if (size < bytes || size > bytes * 2) {
    if (held.tiles) retire(device, held.tiles)
    held.tiles = device.createBuffer({
      label: 'Trillion3D fog local volumes tiles',
      size: bytes,
      usage: GPUBufferUsage.STORAGE,
    })
  }
  return held.tiles
}

/** The buffer of the lists released: no volume is drawn. */
export function releaseLocalFogTiles(gpu: Pick<WebgpuGpuState, 'localFog'>) {
  if (!gpu.localFog?.tiles) return
  gpu.localFog.tiles.destroy()
  gpu.localFog.tiles = undefined
}

/** The view's state for the lists let go. */
export function disposeLocalFog(gpu: Pick<WebgpuGpuState, 'localFog'>) {
  releaseLocalFogTiles(gpu)
  gpu.localFog = undefined
}

/**
 * What the programs that read the fog are bound to this image: the fog's resources (the cubemap and
 * the volume the image built, else the stand-ins; the sky light's cube in the place of the cubemap
 * while the sky light lights the fog) with the lists of the local fog volumes — the
 * buffer made for this image's tiles, else the stand-in's one word, which a program finds too small
 * for the view's tiling and walks every volume. One object while neither changed. None before the
 * stand-ins exist.
 */
export function fogReadOf(rt: Pick<WebgpuPagesRuntime, 'gpu'>): FogRead | undefined {
  const { gpu } = rt
  const base = gpu.fogVolume?.skyRead ?? gpu.fogVolume?.read ?? gpu.deferred?.placeholders.fog
  const tiles = gpu.localFog?.tiles
  if (!base || !tiles) return base
  const held = gpu.localFog!.composed
  if (held?.base === base && held.tiles === tiles) return held.read
  const read = { ...base, tiles }
  gpu.localFog!.composed = { base, tiles, read }
  return read
}
