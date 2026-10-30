import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { uniformBuffer } from '../../gpu/core/uniformBlock.ts'
import {
  FOG_BLUR_PASS,
  FOG_SEPARATE_PASS,
  FOG_UPSAMPLE_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import type { PreparedPipeline } from '../deferred/fullscreen.ts'
import { blurSteps, type BlurStep } from './separatePlan.ts'
import {
  SEPARATE_BLUR_BINDINGS as BLUR,
  SEPARATE_SIDE_FORMAT,
  SEPARATE_UPSAMPLE_BINDINGS as UPSAMPLE,
} from './separateWgsl.ts'

/**
 * THE TEXTURES OF THE FOG DRAWN INTO TEXTURES OF ITS OWN (`separate.ts`), of the size the image's targets are
 * allocated at (the rect drawn is their corner): the
 * colour texture with its levels, the side texture, the filtered chain, and the groups and uniforms
 * of the blur steps and of the upsample that bind them.
 */

/** Bytes between the uniforms of the blur steps: the offset a uniform binding is aligned to. */
export const STEP_STRIDE = 256
/** Bytes a blur step's uniform holds: the step's values and the sizes of the rect drawn. */
export const STEP_BYTES = 32

/** The textures of a size and what binds them. */
export interface Targets {
  readonly width: number
  readonly height: number
  readonly mips: number
  readonly textures: GPUTexture[]
  readonly bytes: number
  readonly colourFirst: GPUTextureView
  /** The colour texture's second level, none with one level: where the temporal filter writes. */
  readonly colourSecond: GPUTextureView | undefined
  readonly sideView: GPUTextureView
  readonly upsampleGroup: GPUBindGroup
  readonly steps: readonly {
    readonly step: BlurStep
    readonly group: GPUBindGroup
    readonly stage: PreparedPipeline<GPUComputePipeline>
    readonly offset: number
  }[]
  readonly stepBuffer: GPUBuffer
  readonly upsampleLook: GPUBuffer
}

const BYTES_PER_TEXEL = { colour: 8, side: 4 }

/** What the textures are made on: the blur stages by kind, the upsample's layout and the sampler. */
export interface TargetKit {
  readonly stages: Record<
    BlurStep['kind'],
    { layout: GPUBindGroupLayout; pipeline: PreparedPipeline<GPUComputePipeline> }
  >
  readonly upsampleLayout: GPUBindGroupLayout
  readonly sampler: GPUSampler
}

/** The textures for `width` × `height`, `mips` levels, with their groups. */
export function createSeparateTargets(
  device: GPUDevice,
  kit: TargetKit,
  width: number,
  height: number,
  mips: number,
): Targets {
  const { stages, upsampleLayout, sampler } = kit
  const size = [width, height] as const
  const make = (label: string, format: GPUTextureFormat, levels: number, usage: number) =>
    device.createTexture({ label, size, format, mipLevelCount: levels, usage })
  const sampled = GPUTextureUsage.TEXTURE_BINDING
  const colour = make(
    FOG_SEPARATE_PASS,
    HDR_FORMAT,
    mips,
    sampled | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING,
  )
  const side = make(
    FOG_SEPARATE_PASS,
    SEPARATE_SIDE_FORMAT,
    1,
    sampled | GPUTextureUsage.RENDER_ATTACHMENT,
  )
  const textures = [colour, side]
  const level = (texture: GPUTexture, at: number) =>
    texture.createView({ dimension: '2d', baseMipLevel: at, mipLevelCount: 1 })
  const steps = blurSteps(mips)
  const stepBuffer = uniformBuffer(device, FOG_BLUR_PASS, Math.max(1, steps.length) * STEP_STRIDE)
  const blurred =
    mips > 1
      ? make(FOG_BLUR_PASS, HDR_FORMAT, mips, sampled | GPUTextureUsage.STORAGE_BINDING)
      : undefined
  if (blurred) textures.push(blurred)
  const wholeBlurred = blurred?.createView({ dimension: '2d' })
  const upsampleLook = uniformBuffer(device, FOG_UPSAMPLE_PASS, 16)
  const sideView = side.createView()
  const stepGroups = steps.map((step, at) => {
    const stage = stages[step.kind]
    // Down: the level above it into the level; filter: the level into the filtered texture;
    // blend: the filtered chain into the level.
    const read =
      step.kind === 'blend'
        ? wholeBlurred!
        : level(colour, step.level - (step.kind === 'downsample' ? 1 : 0))
    const write = step.kind === 'filter' ? level(blurred!, step.level) : level(colour, step.level)
    return {
      step,
      stage: stage.pipeline,
      offset: at * STEP_STRIDE,
      group: device.createBindGroup({
        label: FOG_BLUR_PASS,
        layout: stage.layout,
        entries: [
          {
            binding: BLUR.look,
            resource: { buffer: stepBuffer, offset: at * STEP_STRIDE, size: STEP_BYTES },
          },
          { binding: BLUR.source, resource: read },
          { binding: BLUR.sampler, resource: sampler },
          { binding: BLUR.level, resource: write },
        ],
      }),
    }
  })
  const colourWhole = colour.createView({ dimension: '2d' })
  return {
    width,
    height,
    mips,
    textures,
    bytes: Math.ceil(
      width *
        height *
        (BYTES_PER_TEXEL.colour * (blurred ? 2 : 1) * (mips > 1 ? 4 / 3 : 1) +
          BYTES_PER_TEXEL.side),
    ),
    colourFirst: level(colour, 0),
    colourSecond: mips > 1 ? level(colour, 1) : undefined,
    sideView,
    stepBuffer,
    upsampleLook,
    steps: stepGroups,
    upsampleGroup: device.createBindGroup({
      label: FOG_UPSAMPLE_PASS,
      layout: upsampleLayout,
      entries: [
        ...sequentialEntries([colourWhole, sideView, sampler]),
        { binding: UPSAMPLE.look, resource: { buffer: upsampleLook } },
      ],
    }),
  }
}

/** Lets go of the textures and buffers of `targets`. */
export function releaseSeparateTargets(targets: Targets) {
  for (const texture of targets.textures) texture.destroy()
  targets.stepBuffer.destroy()
  targets.upsampleLook.destroy()
}
