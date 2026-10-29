import { queueListBase } from './queueWgsl.ts'
import { PT_VIEW, PT_VIEW_STRIDE } from './viewWgsl.ts'

/** What every block of an image's dispatches shares: the image's matrix and eye, its counts, the settings the kernels read. */
export interface PathTracingBlockImage {
  /** The inverse of the view-projection the surfaces were drawn with, column-major. */
  readonly inverseViewProjection: ArrayLike<number>
  /** The view-projection the surfaces were drawn with, column-major. */
  readonly viewProjection: ArrayLike<number>
  readonly eye: readonly [number, number, number]
  /** The pre-exposure the run was begun with. */
  readonly baseExposure: number
  readonly size: readonly [number, number]
  readonly maxSamples: number
  readonly iteration: number
  readonly temporalSeed: number
  readonly maxBounces: number
  readonly misMode: number
  readonly samplerType: number
  readonly maxPathIntensity: number
  readonly approximateCaustics: boolean
  readonly backgroundAlpha: number
  readonly emissive: boolean
  readonly visibleLights: number
  readonly adaptive: boolean
  readonly lights: number
  readonly pathCapacity: number
  readonly bounceLevels: number
  /** The bounce up to which the paths are compacted into a list of their own (`compactionDepthOf`). */
  readonly compactionDepth: number
  readonly errorThreshold: number
  readonly filterWidth: number
  /** The rounds a bounce takes after its own: none while no surface of the scene lets light through (`hitPlacementsOf`). */
  readonly passRounds: number
}

/** The last bounce whose paths are compacted (`pathTracingCompactionDepth`): a value under one or past the last bounce compacts every bounce; the bounces after it go on over the list of the one that was last compacted. */
export const compactionDepthOf = (setting: number, maxBounces: number) =>
  !(setting >= 1) || setting > maxBounces ? maxBounces : Math.floor(setting)

/** A tile of the view: its first pixel and its size. */
export type PathTracingTile = readonly [number, number, number, number]

/** The float and the word views of the array the blocks are written in, one 256-byte block of `PT_VIEW_STRIDE` bytes a dispatch. */
export interface PathTracingBlocks {
  readonly floats: Float32Array<ArrayBuffer>
  readonly words: Uint32Array<ArrayBuffer>
}

/** The array of `count` blocks. */
export function createBlocks(count: number): PathTracingBlocks {
  const floats = new Float32Array((count * PT_VIEW_STRIDE) / 4)
  return { floats, words: new Uint32Array(floats.buffer) }
}

/**
 * Writes block `index` for the dispatch of round `round` of bounce `bounce` over `tile` (`PT_VIEW`): the parameters of `image`, the tile, the bounce, and the blend factor of the accumulation (one over the
 * samples gathered once this one is, `1 / (iteration + 1)`). Returns the byte offset of the block, which the dispatch binds it at.
 */
export function writeBlock(
  blocks: PathTracingBlocks,
  index: number,
  image: PathTracingBlockImage,
  tile: PathTracingTile,
  bounce: number,
  round = 0,
) {
  const { floats, words } = blocks
  const base = (index * PT_VIEW_STRIDE) / 4
  const at = PT_VIEW.at
  floats.set(image.inverseViewProjection, base + at.inverseViewProjection)
  floats.set(image.viewProjection, base + at.viewProjection)
  floats.set([...image.eye, image.baseExposure], base + at.eye)
  words.set(tile, base + at.tile)
  words.set([image.size[0], image.size[1], image.maxSamples, image.iteration], base + at.image)
  words.set(
    [image.temporalSeed >>> 0, image.maxBounces, image.misMode, image.samplerType],
    base + at.seeds,
  )
  floats.set(
    [
      image.maxPathIntensity,
      image.approximateCaustics ? 1 : 0,
      image.backgroundAlpha,
      1 / (image.iteration + 1),
    ],
    base + at.limits,
  )
  words.set(
    [image.emissive ? 1 : 0, image.visibleLights, image.adaptive ? 1 : 0, bounce],
    base + at.flags,
  )
  words.set(
    [image.lights, image.pathCapacity, image.compactionDepth, queueListBase(image.bounceLevels)],
    base + at.counts,
  )
  floats.set([image.errorThreshold, image.filterWidth, round, image.passRounds], base + at.sampling)
  return index * PT_VIEW_STRIDE
}
