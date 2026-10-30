import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { dispatchOn, layoutStagesOf } from '../../gpu/core/computeStages.ts'
import { uniformBlock } from '../../gpu/core/uniformBlock.ts'
import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import {
  FOG_BLUR_PASS,
  FOG_SEPARATE_PASS,
  FOG_UPSAMPLE_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import { KEEP_ALPHA, LIGHT_THROUGH } from '../../materials/surface/materialBlending.ts'
import { primedExtent as mipSide } from '../../frame/render/primeState.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import {
  chainReady,
  fullscreenDescriptor,
  preparedPipeline,
  type PreparedPipeline,
} from '../deferred/fullscreen.ts'
import { blurMipCount } from './separatePlan.ts'
import { createFogTemporalGpu, type TemporalInput } from './separateTemporal.ts'
import {
  createSeparateTargets,
  releaseSeparateTargets,
  STEP_STRIDE,
  type Targets,
} from './separateTargets.ts'
import {
  SEPARATE_BLUR_BINDINGS as BLUR,
  SEPARATE_BLUR_CODE,
  SEPARATE_BLUR_ENTRIES,
  SEPARATE_BLUR_GROUP,
  SEPARATE_COMPOSE_BINDINGS as COMPOSE,
  SEPARATE_COMPOSE_ENTRY,
  SEPARATE_SIDE_FORMAT,
  SEPARATE_UPSAMPLE_BINDINGS as UPSAMPLE,
  SEPARATE_UPSAMPLE_ENTRY,
  separateComposeWgsl,
  separateUpsampleWgsl,
} from './separateWgsl.ts'

/**
 * THE FOG DRAWN INTO TEXTURES OF ITS OWN (`separateWgsl.ts` says what each holds): the pass that
 * writes them, the chain of blurs that builds the colour texture's levels, and the pass that lays
 * the result over the lit image. The image's pass writes the first level and the side texture
 * (`compose`), the clouds are composed into the first level (`colourView`), `blur` builds the
 * other levels and `upsample` lays the texture over the image, the colour added and the image multiplied
 * by the alpha.
 */

/** The values the passes of an image read. */
export interface SeparateLook {
  /** The size of the rect the image draws, the corner of the textures (allocated at the largest size a scale change draws at). */
  readonly width: number
  readonly height: number
  /** The scale of the blur's taps: the view's resolution fraction. */
  readonly blurScale: number
  /** The share of the coarser level blended into each level, in [0, 1]. */
  readonly blurControl: number
  /** The most luminance a texel holds in the blur. */
  readonly maxLuminance: number
  /** The scale of the level a pixel reads. */
  readonly spread: number
  /** The scale and the power of the share of the image the scattering takes. */
  readonly amountScale: number
  readonly amountPower: number
}

/** The fog textures of a device: pipelines asked now, off the frame; the textures of the size the image's
 *  targets are allocated at, made again when it changes (the image draws a rect of their corner). */
export function createFogSeparateGpu(
  device: GPUDevice,
  failed: (error: unknown) => void,
  localFog: boolean,
) {
  const sampler = device.createSampler({
    label: FOG_BLUR_PASS,
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  })
  const fragment = GPUShaderStage.FRAGMENT
  const composeModule = device.createShaderModule({
    label: FOG_SEPARATE_PASS,
    code: wgslModule(separateComposeWgsl(localFog)),
  })
  const composeLayout = device.createBindGroupLayout({
    label: FOG_SEPARATE_PASS,
    entries: [
      computeTextureEntry(COMPOSE.sceneColor, 'unfilterable-float', '2d', fragment),
      computeUniformEntry(COMPOSE.scatter, {}, fragment),
    ],
  })
  const upsampleLayout = device.createBindGroupLayout({
    label: FOG_UPSAMPLE_PASS,
    entries: [
      computeTextureEntry(UPSAMPLE.colour, 'float', '2d', fragment),
      computeTextureEntry(UPSAMPLE.side, 'unfilterable-float', '2d', fragment),
      computeSamplerEntry(UPSAMPLE.sampler, 'filtering', fragment),
      computeUniformEntry(UPSAMPLE.look, {}, fragment),
    ],
  })
  const upsample = preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      device.createShaderModule({ label: FOG_UPSAMPLE_PASS, code: separateUpsampleWgsl }),
      upsampleLayout,
      SEPARATE_UPSAMPLE_ENTRY,
      [{ format: HDR_FORMAT, blend: { color: LIGHT_THROUGH, alpha: KEEP_ALPHA } }],
      FOG_UPSAMPLE_PASS,
    ),
  ).ask()
  upsample.prepare().catch(failed)
  // The composition's pipeline is on the fog pass's layout, made when that is.
  const composes = new WeakMap<GPUBindGroupLayout, PreparedPipeline<GPURenderPipeline>>()
  const composeFor = (fogLayout: GPUBindGroupLayout) => {
    let made = composes.get(fogLayout)
    if (!made) {
      made = preparedPipeline(
        device,
        fullscreenDescriptor(
          device,
          composeModule,
          [fogLayout, composeLayout],
          SEPARATE_COMPOSE_ENTRY,
          [{ format: HDR_FORMAT }, { format: SEPARATE_SIDE_FORMAT }],
          FOG_SEPARATE_PASS,
        ),
      ).ask()
      made.prepare().catch(failed)
      composes.set(fogLayout, made)
    }
    return made
  }
  const blurModule = device.createShaderModule({ label: FOG_BLUR_PASS, code: SEPARATE_BLUR_CODE })
  const blurEntries = [
    computeUniformEntry(BLUR.look),
    computeTextureEntry(BLUR.source, 'float'),
    computeSamplerEntry(BLUR.sampler, 'filtering'),
    computeStorageTextureEntry(BLUR.level, HDR_FORMAT),
  ]
  const temporal = createFogTemporalGpu(device, failed)
  const makeStage = layoutStagesOf(device, FOG_BLUR_PASS)
  const [downsampleEntry, filterEntry, blendEntry] = SEPARATE_BLUR_ENTRIES
  const stages = {
    downsample: makeStage('down', blurModule, downsampleEntry, blurEntries),
    filter: makeStage('filter', blurModule, filterEntry, blurEntries),
    blend: makeStage('blend', blurModule, blendEntry, blurEntries),
  }
  for (const { pipeline } of Object.values(stages)) pipeline.prepare().catch(failed)

  const composeAttachments: GPURenderPassColorAttachment[] = [
    {
      view: undefined as unknown as GPUTextureView,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: [0, 0, 0, 1],
    },
    {
      view: undefined as unknown as GPUTextureView,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: [0, 1, 0, 0],
    },
  ]
  const composePass: GPURenderPassDescriptor = {
    label: FOG_SEPARATE_PASS,
    colorAttachments: composeAttachments,
  }
  const upsampleAttachment: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'load',
    storeOp: 'store',
  }
  const upsamplePass: GPURenderPassDescriptor = {
    label: FOG_UPSAMPLE_PASS,
    colorAttachments: [upsampleAttachment],
  }
  const scatter = uniformBlock(device, FOG_SEPARATE_PASS, 16)
  let targets: Targets | undefined
  let composeGroup: { hdr: GPUTextureView; group: GPUBindGroup } | undefined
  // What the blur's buffers were last written for.
  let written: (SeparateLook & { mips: number }) | undefined

  /** The textures for `width` × `height`, `mips` levels, made again when the size or the levels change. */
  function allocate(width: number, height: number, mips: number) {
    if (targets && targets.width === width && targets.height === height && targets.mips === mips)
      return targets
    release()
    written = undefined
    return (targets = createSeparateTargets(
      device,
      { stages, upsampleLayout, sampler },
      width,
      height,
      mips,
    ))
  }

  function release() {
    if (targets) releaseSeparateTargets(targets)
    targets = composeGroup = undefined
    written = undefined
  }

  return {
    /** Whether the pipelines of an image are compiled, each asked now otherwise; `fogLayout`, the fog pass's. */
    ready: (fogLayout: GPUBindGroupLayout) =>
      chainReady(
        composeFor(fogLayout),
        upsample,
        stages.downsample.pipeline,
        stages.filter.pipeline,
        stages.blend.pipeline,
      ),
    /** The textures for targets allocated at `width` × `height` with the scattering's blur chain or none. */
    allocate: (width: number, height: number, scattering: boolean) =>
      allocate(width, height, blurMipCount(width, height, scattering)),
    /** The first level of the colour texture, where the clouds are composed. */
    colourView: () => targets?.colourFirst,
    get bytes() {
      return (targets?.bytes ?? 0) + temporal.bytes
    },
    /** Whether the temporal filter's stage is compiled, asked now otherwise. */
    temporalReady: temporal.ready,
    /** Lets go of the temporal filter's history, where the filter does not run. */
    releaseHistory: temporal.release,
    /** Draws the fog into the textures over the lit image `hdr`, the fog pass's group 0 `fogGroup` bound. */
    compose(
      encoder: GPUCommandEncoder,
      fogLayout: GPUBindGroupLayout,
      fogGroup: GPUBindGroup,
      hdr: GPUTextureView,
      look: SeparateLook,
    ) {
      const t = targets!
      scatter.words.f[0] = look.amountScale
      scatter.words.f[1] = look.amountPower
      scatter.send()
      if (composeGroup?.hdr !== hdr)
        composeGroup = {
          hdr,
          group: device.createBindGroup({
            label: FOG_SEPARATE_PASS,
            layout: composeLayout,
            entries: [
              { binding: COMPOSE.sceneColor, resource: hdr },
              { binding: COMPOSE.scatter, resource: { buffer: scatter.buffer } },
            ],
          }),
        }
      composeAttachments[0].view = t.colourFirst
      composeAttachments[1].view = t.sideView
      drawFullscreenTriangle(
        encoder,
        composePass,
        composeFor(fogLayout).get(),
        [fogGroup, composeGroup.group],
        look.width,
        look.height,
      )
    },
    /** Builds the colour texture's other levels (the blur chain) and writes the values the upsample reads;
     *  the second level is the temporal filter's where `filtered` asks it: true once it ran. */
    blur(encoder: GPUCommandEncoder, look: SeparateLook, filtered?: TemporalInput) {
      const t = targets!
      const second = t.colourSecond
      const secondDone = !!filtered && !!second
      if (secondDone) temporal.run(encoder, t.colourFirst, second, t, look, filtered)
      if (
        !written ||
        written.mips !== t.mips ||
        written.width !== look.width ||
        written.height !== look.height ||
        written.blurScale !== look.blurScale ||
        written.blurControl !== look.blurControl ||
        written.maxLuminance !== look.maxLuminance ||
        written.spread !== look.spread
      ) {
        const bytes = new Float32Array((t.steps.length * STEP_STRIDE) / 4 || 4)
        t.steps.forEach(({ step, offset }) => {
          // The level the step reads beside the one it writes: the one above, the same, the one below.
          const beside =
            step.level + (step.kind === 'downsample' ? -1 : step.kind === 'blend' ? 1 : 0)
          bytes.set(
            [
              look.blurScale,
              look.blurControl,
              look.maxLuminance,
              step.kind === 'blend' ? step.level : 0,
              mipSide(look.width, step.level),
              mipSide(look.height, step.level),
              mipSide(look.width, beside),
              mipSide(look.height, beside),
            ],
            offset / 4,
          )
        })
        device.queue.writeBuffer(t.stepBuffer, 0, bytes)
        device.queue.writeBuffer(
          t.upsampleLook,
          0,
          new Float32Array([look.spread, t.mips - 1, look.width / t.width, look.height / t.height]),
        )
        written = { ...look, mips: t.mips }
      }
      if (!t.steps.length) return secondDone
      const pass = encoder.beginComputePass({ label: FOG_BLUR_PASS })
      for (const { step, stage, group } of t.steps) {
        if (secondDone && step.kind === 'downsample' && step.level === 1) continue
        dispatchOn(
          pass,
          stage,
          group,
          ceilDiv(mipSide(look.width, step.level), SEPARATE_BLUR_GROUP),
          ceilDiv(mipSide(look.height, step.level), SEPARATE_BLUR_GROUP),
        )
      }
      pass.end()
      return secondDone
    },
    /** Lays the colour texture's level the width names over `hdr`, once `blur` wrote the values it reads. */
    upsample(encoder: GPUCommandEncoder, hdr: GPUTextureView, look: SeparateLook) {
      const t = targets!
      upsampleAttachment.view = hdr
      drawFullscreenTriangle(
        encoder,
        upsamplePass,
        upsample.get(),
        t.upsampleGroup,
        look.width,
        look.height,
      )
    },
    dispose() {
      release()
      scatter.buffer.destroy()
      temporal.dispose()
    },
  }
}

/** The fog's textures and passes of a device. */
export type FogSeparateGpu = ReturnType<typeof createFogSeparateGpu>
