import type { Texture } from '../../../../sdk-core/src/index.ts'
import { texelsRefusal, textureRgba } from '../../visibility/types.ts'
import { generateMaterialMips, type MipChain } from '../../texture/mipBatch.ts'
import { materialMipTexture } from '../../texture/mips.ts'
import { mipLevelCountFor } from '../../texture/tiles.ts'
import type { CoverageReaders } from '../../texture/coverage.ts'
import { writeRgba } from './write.ts'
import { createTexelTurn, turnFlags, type TexelTurn } from './texelTurn.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { READBACK_IDLE_MS } from '../../gpu/core/heldReadback.ts'

/**
 * Working texture of a host texture: the whole source, transferred once, and its mip chain built
 * by the GPU with the materials rule (mean in colour, weighted by alpha where every reader takes
 * alpha for coverage, median in alpha, scaled at the readers' cutoff), one compute pass
 * (`generateMaterialMips`). Tiles are then copied into the pool, level by level: the levels are
 * stored as `materialMipTexture` says — `rgba8unorm`, viewed in the pool's sRGB format for a
 * colour texture —, a format the pool's copies take (they differ in `-srgb` alone). A picture
 * copy into `rgba8unorm` stores the picture's bytes, as into its sRGB twin.
 *
 * This is the path of a texture WITHOUT a cooked chain — one a host decoded itself, or a test
 * scene that gives its texels in memory. It costs the whole source every time a tile of that
 * texture is missing, and that is intended: GPU memory held stays that of the pool, and the
 * price is paid in transfer, measured, never in resident bytes. The cache's cooked chain is the
 * reference path; this one exists only so that no scene is refused. A LIVE texture — one whose
 * picture moved since the session opened: a video, a canvas redrawn — keeps its working texture,
 * one of its own size, refilled in place at each new picture (`fill`, #362).
 */
export type TileScratch = {
  texture: GPUTexture
  /** Bytes it holds, mips included (`textureBytesOf`). */
  bytes: number
  /** Writes the source's current picture again, mips included: what a live texture keeps. Its
   *  turn and its mips in `encoder` when given, submitted by its owner at once (`reduce`), who
   *  `rest`s after. */
  fill(encoder?: GPUCommandEncoder): void
  /** Builds its mips again from the picture it holds, under its readers' rule now (#42): in
   *  `encoder` when given, which its owner submits before any other batch writes the mips'
   *  uniforms (`generateMaterialMips`), else in a submit of its own. */
  reduce(encoder?: GPUCommandEncoder): void
  /** Its mips not built since its first picture: `reduce`, or a batch taking its `chain`. */
  readonly stale: boolean
  /** What `reduce` hands `generateMaterialMips`, for a batch that reduces several at once: the
   *  mips are then built, no longer `stale`. */
  chain(): MipChain
  /** The command buffer of its last picture was submitted: its turn gives its ring back
   *  (`texelTurn.ts`). Called at once when no encoder was handed. */
  settle(): void
  /** A live texture's picture was submitted: its turn keeps its ring and words for the next
   *  picture — taken once, never again a picture —, and gives them back (`settle`) once no picture
   *  came for `READBACK_IDLE_MS`, as the device's spares do (`heldBuffers`). */
  rest(): void
  destroy(): void
}

/** What a working texture is made of: its host texture, size and pool format, the error code of a
 *  picture it cannot read. */
type ScratchOptions = {
  map: Texture
  width: number
  height: number
  format: GPUTextureFormat
  errorCode: string
  /** The colour census's readers, whose rule each reduction asks; none for a data texture. */
  coverage?: CoverageReaders
}

/** The working texture's descriptor: stored as `materialMipTexture` says, its whole chain. */
function scratchDescriptor({ width, height, format }: ScratchOptions): GPUTextureDescriptor {
  return {
    label: 'Trillion3D texture scratch',
    size: { width, height, depthOrArrayLayers: 1 },
    ...materialMipTexture(format),
    mipLevelCount: mipLevelCountFor(width, height),
    // A picture copy writes as a draw does: it asks `RENDER_ATTACHMENT` of its destination.
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT,
  }
}

/** Sends the picture as it is now into `texture`, its mips not built, under the host texture's
 *  `flipY` and `premultiplyAlpha`: the picture's last row lands at v = 0 (#362). Raw texels to turn
 *  go through `held.turned`, made at the first such picture; a turn is encoded in `encoder` when
 *  given. */
function uploadPicture(
  device: GPUDevice,
  texture: GPUTexture,
  { map, width, height, errorCode }: ScratchOptions,
  held: { turned?: TexelTurn },
  encoder?: GPUCommandEncoder,
) {
  const rgba = textureRgba(map)
  if (rgba) {
    const refusal = texelsRefusal(map)
    if (refusal) throw new Error(refusal)
    if (rgba.width !== width || rgba.height !== height) throw new Error('TEXTURE_SOURCE_SIZE')
    // Turned on the GPU, never texel by texel here.
    const flags = turnFlags(map)
    if (!flags) writeRgba(device.queue, texture, [0, 0, 0], rgba.data, width, height)
    else {
      held.turned ??= createTexelTurn(device, texture, width, height)
      held.turned.upload(rgba.data, flags, encoder)
    }
  } else {
    const image = map.image as GPUCopyExternalImageSource | undefined
    if (!image || typeof device.queue.copyExternalImageToTexture !== 'function')
      throw new Error(errorCode)
    device.queue.copyExternalImageToTexture(
      { source: image, flipY: map.flipY },
      { texture, premultipliedAlpha: map.premultiplyAlpha },
      [width, height],
    )
  }
}

/** When the turn of `held` gives its ring and words back: at once (`settle`), or once no picture
 *  came for `READBACK_IDLE_MS` (`rest`). */
function turnRelease(held: { turned?: TexelTurn }) {
  let idle: ReturnType<typeof setTimeout> | undefined
  const settle = () => {
    clearTimeout(idle)
    held.turned?.release()
  }
  const rest = () => {
    clearTimeout(idle)
    if (!held.turned) return
    idle = setTimeout(settle, READBACK_IDLE_MS)
    // A host process never waits on the hold.
    ;(idle as { unref?: () => void }).unref?.()
  }
  return { settle, rest }
}

export function createTileScratch(
  device: GPUDevice,
  options: ScratchOptions,
  /** Where its first picture is encoded — submitted by its owner, who `settle`s after —, else in
   *  a submit of its own. */
  first?: GPUCommandEncoder,
): TileScratch {
  const { width, height, format } = options
  const descriptor = scratchDescriptor(options)
  const texture = device.createTexture(descriptor)
  /** The GPU turn of raw texels the host texture asks to flip or premultiply (`texelTurn.ts`):
   *  made at the first such picture, its ring given back after it — a static picture fills once
   *  (`settle`) —, kept while a live texture's pictures keep coming (`rest`). */
  const held: { turned?: TexelTurn } = {}
  let stale = true
  const upload = (encoder?: GPUCommandEncoder) =>
    uploadPicture(device, texture, options, held, encoder)
  const chain = (): MipChain => {
    stale = false
    const cutoff = options.coverage?.cutoff(options.map)
    return { texture, format, width, height, weighted: cutoff !== undefined, cutoff }
  }
  const reduce = (encoder?: GPUCommandEncoder) => generateMaterialMips(device, [chain()], encoder)
  const { settle, rest } = turnRelease(held)
  try {
    upload(first)
  } catch (error) {
    // A picture refused at its first fill leaves no texture behind: its tile asks again.
    texture.destroy()
    settle()
    throw error
  }
  if (!first) settle()
  return {
    texture,
    bytes: textureBytesOf(descriptor) ?? 0,
    fill: (encoder?: GPUCommandEncoder) => {
      upload(encoder)
      reduce(encoder)
    },
    reduce,
    get stale() {
      return stale
    },
    chain,
    settle,
    rest,
    destroy: () => {
      texture.destroy()
      settle()
    },
  }
}
