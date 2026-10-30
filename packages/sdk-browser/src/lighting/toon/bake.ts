import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { askedComputeProgram, dispatchOn } from '../../gpu/core/computeStages.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { TOON_PROFILE_BAKE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { textureRgba } from '../../visibility/types.ts'
import { sourceSize } from '../../materials/texture/pictureSize.ts'
import { writeTexels } from '../../materials/virtual/write.ts'
import type { ToonLayout } from '../../../../sdk-core/src/lighting/toonProfile/rows.ts'
import { TOON_BAKE_WGSL } from './bakeWgsl.ts'

const ENTRIES: GPUBindGroupLayoutEntry[] = [
  computeUniformEntry(0),
  computeTextureEntry(1, 'float'),
  computeTextureEntry(2, 'float'),
  computeSamplerEntry(3),
  computeBufferEntry(4, 'storage'),
]

/** The programs of the bake, a sampler that repeats and the picture of an absent image (black), once a device. */
const bakeProgram = oncePerDevice((device: GPUDevice) => {
  const failed = (error: unknown) => console.error('toon bake failed to compile', error)
  const program = (entry: string) =>
    askedComputeProgram(device, failed, TOON_PROFILE_BAKE_PASS, ENTRIES, TOON_BAKE_WGSL, entry)
  const black = device.createTexture({
    label: 'Trillion3D toon black image',
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture({ texture: black }, new Uint8Array(4), { bytesPerRow: 4 }, [1, 1])
  return {
    offsets: program('bakeOffsets'),
    hatching: program('bakeHatching'),
    sampler: device.createSampler({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    }),
    black: black.createView(),
  }
})

/**
 * The image of `texture` as a texture to sample, read as authored (an sRGB image decoded): its raw texels where it holds them in memory,
 * else copied from its picture, turned as its `flipY` says. Handed to the frame's retire list at once, the bake that names it being
 * already encoded.
 */
function pictureOf(device: GPUDevice, texture: Texture) {
  const rgba = textureRgba(texture)
  const [width, height] = sourceSize(texture)
  const picture = device.createTexture({
    label: 'Trillion3D toon image',
    size: [width, height],
    format: texture.colorSpace === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  if (rgba) writeTexels(device.queue, picture, [0, 0, 0], rgba.data, width, height)
  else
    device.queue.copyExternalImageToTexture(
      { source: texture.image as GPUCopyExternalImageSource, flipY: texture.flipY },
      { texture: picture, premultipliedAlpha: texture.premultiplyAlpha },
      [width, height],
    )
  retire(device, picture)
  return picture.createView()
}

/** Where the image of `texture` stands: none given (`absent`), still loading, decoded (raw texels in memory, a picture that has loaded, a bitmap or a canvas with a size, a video with a frame), or failed for good. */
export type ImageState = 'absent' | 'loading' | 'decoded' | 'failed'

export function imageState(texture: Texture): ImageState {
  if (textureRgba(texture)) return 'decoded'
  const picture = texture.image as {
    complete?: boolean
    currentSrc?: string
    naturalWidth?: number
    src?: string
    readyState?: number
    videoWidth?: number
    width?: number
  } | null
  if (!picture) return 'absent'
  // A video holds a frame once it has data for the current position.
  if (picture.readyState !== undefined)
    return picture.readyState >= 2 && (picture.videoWidth ?? 0) > 0 ? 'decoded' : 'loading'
  // A picture element completes with a width, or with none when it failed; one that has no source yet is complete with none too, and has nothing to wait for.
  if (picture.complete !== undefined) {
    if (!picture.complete) return 'loading'
    if ((picture.naturalWidth ?? 0) > 0) return 'decoded'
    return picture.src || picture.currentSrc ? 'failed' : 'absent'
  }
  // A bitmap or a canvas is made: it holds a frame when it has a size.
  return (picture.width ?? 0) > 0 ? 'decoded' : 'failed'
}

/** What one slot of the patterns is baked from: the profile's offset images and hatching image. */
export interface ToonBakeSource {
  readonly diffuseOffset: Texture | null
  readonly specularOffset: Texture | null
  readonly hatching: Texture | null
}

/**
 * Bakes the images of the pattern slots `slots` (`ToonBakeSource`, slot after slot) into the toon buffer `buffer` from `patternsAt` (the
 * first word of the patterns, `layout.patternWords` a slot) with the compute pass of `encoder`; false while the programs are not compiled (the
 * caller bakes at a later image).
 */
export function bakeToonPatterns(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  buffer: GPUBuffer,
  patternsAt: number,
  layout: ToonLayout,
  slots: readonly ToonBakeSource[],
) {
  const program = bakeProgram(device)
  if (!program.offsets.pipeline.get() || !program.hatching.pipeline.get()) return false
  const pass = encoder.beginComputePass({ label: TOON_PROFILE_BAKE_PASS })
  const { patternWords, texels } = layout
  const groups = texels / 8
  slots.forEach((source, slot) => {
    const bind = (
      first: Texture | null,
      second: Texture | null,
      at: number,
      layout: GPUBindGroupLayout,
    ) => {
      const uniform = device.createBuffer({
        label: 'Trillion3D toon bake word',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(uniform, 0, new Uint32Array([at, texels, 0, 0]))
      retire(device, uniform)
      return device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          {
            binding: 1,
            resource:
              first && imageState(first) === 'decoded' ? pictureOf(device, first) : program.black,
          },
          {
            binding: 2,
            resource:
              second && imageState(second) === 'decoded'
                ? pictureOf(device, second)
                : program.black,
          },
          { binding: 3, resource: program.sampler },
          { binding: 4, resource: { buffer } },
        ],
      })
    }
    const first = patternsAt + slot * patternWords
    dispatchOn(
      pass,
      program.offsets.pipeline,
      bind(source.diffuseOffset, source.specularOffset, first, program.offsets.layout),
      groups,
      groups,
    )
    dispatchOn(
      pass,
      program.hatching.pipeline,
      bind(source.hatching, null, first + patternWords / 2, program.hatching.layout),
      groups,
      groups,
    )
  })
  pass.end()
  return true
}
