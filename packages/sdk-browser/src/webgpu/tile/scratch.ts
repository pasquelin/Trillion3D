import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { texelsRefusal, textureRgba } from '../../visibility/types.ts'
import { generateMaterialMips } from '../../texture/mipBatch.ts'
import type { MipChain } from '../../texture/mipGroups.ts'
import { materialMipTexture, turnFlags } from '../../texture/mips.ts'
import { mipLevelCountFor } from '../../texture/tiles.ts'
import type { CoverageReaders } from '../../texture/coverage.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { writeRgba } from './write.ts'

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
   *  turn and its mips in `encoder` when given, submitted by its owner at once (`reduce`). */
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
  /** The command buffer that turned its picture was submitted: a static picture's raw texels
   *  (`turn`) are let go. A live texture never settles: it keeps them for its next picture. */
  settle(): void
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

/** What a working texture keeps of its raw texels: the `rgba8unorm` texture `writeTexture` fills
 *  when the host texture asks them turned, and the turn its next reduction runs, if one waits. */
type Raw = { texture?: GPUTexture; turn?: { raw: GPUTexture; flags: number } }

/**
 * Sends the picture as it is now, its mips not built, under the host texture's `flipY` and
 * `premultiplyAlpha`: the picture's last row lands at v = 0 (#362). Raw texels go up as they are,
 * by `writeTexture`: into level 0 when they ask no turn; into `raw` otherwise, which the next
 * reduction turns into level 0 as its first step (`turnLevel`, `../../texture/mipsWgsl.ts`) — no
 * texel touched here, no ring, no pass of their own.
 */
function uploadPicture(
  device: GPUDevice,
  texture: GPUTexture,
  { map, width, height, errorCode }: ScratchOptions,
  raw: Raw,
) {
  const rgba = textureRgba(map)
  if (rgba) {
    const refusal = texelsRefusal(map)
    if (refusal) throw new Error(refusal)
    if (rgba.width !== width || rgba.height !== height) throw new Error('TEXTURE_SOURCE_SIZE')
    const flags = turnFlags(map)
    if (!flags) return writeRgba(device.queue, texture, [0, 0, 0], rgba.data, width, height)
    raw.texture ??= device.createTexture({
      label: 'Trillion3D texture raw texels',
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    writeRgba(device.queue, raw.texture, [0, 0, 0], rgba.data, width, height)
    raw.turn = { raw: raw.texture, flags }
  } else {
    const image = map.image as GPUCopyExternalImageSource | undefined
    if (!image) throw new Error(errorCode)
    device.queue.copyExternalImageToTexture(
      { source: image, flipY: map.flipY },
      { texture, premultipliedAlpha: map.premultiplyAlpha },
      [width, height],
    )
  }
}

export function createTileScratch(device: GPUDevice, options: ScratchOptions): TileScratch {
  const { width, height, format } = options
  const descriptor = scratchDescriptor(options)
  const texture = device.createTexture(descriptor)
  /** Its raw texels, made at the first picture that asks a turn and kept while it lives. */
  const raw: Raw = {}
  let stale = true
  const upload = () => uploadPicture(device, texture, options, raw)
  /** The next reduction's chain, the turn of the picture it waits for taken with it. */
  const chain = (): MipChain => {
    stale = false
    const cutoff = options.coverage?.cutoff(options.map),
      { turn } = raw
    raw.turn = undefined
    return { texture, format, width, height, weighted: cutoff !== undefined, cutoff, turn }
  }
  const reduce = (encoder?: GPUCommandEncoder) => generateMaterialMips(device, [chain()], encoder)
  /** A static picture turned and submitted: its raw texels are let go. */
  const settle = () => {
    if (raw.turn) return
    raw.texture?.destroy()
    raw.texture = undefined
  }
  const destroy = () => {
    texture.destroy()
    raw.texture?.destroy()
    raw.texture = raw.turn = undefined
  }
  try {
    upload()
  } catch (error) {
    // A picture refused at its first fill leaves no texture behind: its tile asks again.
    destroy()
    throw error
  }
  return {
    texture,
    bytes: textureBytesOf(descriptor) ?? 0,
    fill: (encoder?: GPUCommandEncoder) => {
      upload()
      reduce(encoder)
    },
    reduce,
    get stale() {
      return stale
    },
    chain,
    settle,
    destroy,
  }
}
