import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { uniformBlock } from '../../gpu/core/uniformBlock.ts'
import { groupFor } from '../../gpu/bind/cachedGroup.ts'
import { namedGroups } from '../../gpu/core/encoderUniforms.ts'
import { commitOnSubmit, retire } from '../../gpu/core/frameRetire.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import type { ResolvedPlanarReflection } from '../../../../sdk-core/src/scene/planarReflection/contracts.ts'
import {
  inputDeps,
  inputGroupEntries,
  type ScreenSpaceInputs,
} from '../screenSpaceTracing/frame.ts'
import { SCREEN_SPACE_BINDINGS } from '../screenSpaceTracing/rayCastWgsl.ts'
import { writeCompositeBlock, writePrefilterBlock, type PrefilterView } from './block.ts'
import type { PlanarPlane } from './mirror.ts'
import type { PlanarPipelines } from './pipelines.ts'
import {
  PLANAR_COMPOSITE_BINDING,
  PLANAR_COMPOSITE_LAYOUT,
  PLANAR_PREFILTER_LAYOUT,
} from './wgsl.ts'

/**
 * WHAT A PLANAR REFLECTION HOLDS ON THE GPU: the reflection image its mirrored view's lit image is prefiltered into, the blocks of the prefilter and of the
 * composite, and the bind groups over them. The image is `drawn` once the mirrored view has drawn an image and the prefilter has made it from it.
 */
export interface PlanarImage {
  readonly texture: GPUTexture
  readonly view: GPUTextureView
  readonly size: readonly [number, number]
}

export function createPlanarGpu(device: GPUDevice) {
  return {
    device,
    image: undefined as PlanarImage | undefined,
    prefilterBlock: uniformBlock(
      device,
      'Trillion3D planar reflection prefilter block',
      PLANAR_PREFILTER_LAYOUT.words * 4,
    ),
    compositeBlock: uniformBlock(
      device,
      'Trillion3D planar reflection composite block',
      PLANAR_COMPOSITE_LAYOUT.words * 4,
    ),
    groups: namedGroups(),
    /** The projection the mirrored view was drawn with, column-major, which the composite projects the reflection direction by. */
    projection: new Float64Array(16),
    drawn: false,
  }
}
export type PlanarGpu = ReturnType<typeof createPlanarGpu>

/** The reflection image of `gpu` at `size` pixels, made again where it is not that size; a new image holds nothing yet. */
function imageOf(device: GPUDevice, gpu: PlanarGpu, width: number, height: number) {
  if (gpu.image?.size[0] === width && gpu.image.size[1] === height) return gpu.image
  if (gpu.image) retire(device, gpu.image.texture)
  const texture = device.createTexture({
    label: 'Trillion3D planar reflection image',
    size: [width, height],
    format: HDR_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  gpu.drawn = false
  return (gpu.image = { texture, view: texture.createView(), size: [width, height] })
}

/**
 * The prefilter, encoded as the mirrored view hands its lit image over: the reflection image of `drawn` pixels made from `lit` (a target of `allocated`
 * pixels) and `depth` by the program of `pipelines`, over the block of `reflection` for the mirrored camera `view`. Nothing while the pipeline compiles or the view
 * hands no depth.
 */
export function encodePlanarPrefilter(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: PlanarPipelines,
  gpu: PlanarGpu,
  reflection: ResolvedPlanarReflection,
  plane: PlanarPlane,
  view: PrefilterView,
  lit: GPUTextureView,
  depth: GPUTextureView | undefined,
  drawn: readonly number[],
  allocated: readonly number[],
) {
  const pipeline = pipelines.prefilter.get()
  if (!pipeline || !depth) return
  const image = imageOf(device, gpu, drawn[0], drawn[1])
  writePrefilterBlock(gpu.prefilterBlock.words.f, reflection, plane, view, drawn, allocated)
  gpu.prefilterBlock.send()
  const group = groupFor(
    device,
    gpu.groups,
    'prefilter',
    pipelines.layouts.prefilter,
    [lit, depth, gpu.prefilterBlock.buffer],
    () => [
      { binding: 0, resource: lit },
      { binding: 1, resource: postSamplers(device).clamped },
      { binding: 2, resource: depth },
      { binding: 3, resource: { buffer: gpu.prefilterBlock.buffer } },
    ],
  )
  drawFullscreenTriangle(
    encoder,
    {
      label: 'Trillion3D planar reflection prefilter',
      colorAttachments: [
        { view: image.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
    },
    pipeline,
    group,
  )
  // The image counts as drawn, with the projection it was drawn with, once the encoder that writes it is submitted: a dropped encoder leaves the image unwritten and the projection as it was.
  const projection = Float64Array.from(view.projection)
  commitOnSubmit(encoder, () => {
    gpu.projection.set(projection)
    gpu.drawn = true
  })
}

/**
 * The composite, encoded over layer `target` (a 2D view of the first layer of the reflection target) of the main view: the reflection image read by
 * every pixel of the frame `inputs` describes, laid over what the target holds (`blend`: where the rays' share is, or where the environment already
 * is). Nothing while the pipeline compiles or the image holds no view yet.
 */
export function encodePlanarComposite(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: PlanarPipelines,
  gpu: PlanarGpu,
  reflection: ResolvedPlanarReflection,
  plane: PlanarPlane,
  inputs: ScreenSpaceInputs,
  target: GPUTextureView,
  blend: 'scene' | 'screen',
) {
  const pipeline = pipelines.composite[blend].get()
  const image = gpu.image
  if (!pipeline || !image || !gpu.drawn) return
  writeCompositeBlock(gpu.compositeBlock.words.f, reflection, plane, gpu.projection)
  gpu.compositeBlock.send()
  // The image is read through a bilinear sampler in the place of the inputs' nearest one.
  const sampler = postSamplers(device).clamped
  const group = groupFor(
    device,
    gpu.groups,
    'composite',
    pipelines.layouts.composite,
    [...inputDeps(inputs, image.view), gpu.compositeBlock.buffer],
    () => [
      ...inputGroupEntries(inputs, image.view).map((entry) =>
        entry.binding === SCREEN_SPACE_BINDINGS.colorSampler
          ? { ...entry, resource: sampler }
          : entry,
      ),
      { binding: PLANAR_COMPOSITE_BINDING, resource: { buffer: gpu.compositeBlock.buffer } },
    ],
  )
  drawFullscreenTriangle(
    encoder,
    {
      label: 'Trillion3D planar reflection composite',
      colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
    },
    pipeline,
    group,
  )
}

/** Frees what `gpu` holds, retired with the frame whose commands may still name it; at once where the session is gone (`ended`: no frame will run to drain the retired). */
export function destroyPlanarGpu(gpu: PlanarGpu, ended = false) {
  if (gpu.image) retire(gpu.device, gpu.image.texture, ended)
  retire(gpu.device, gpu.prefilterBlock.buffer, ended)
  retire(gpu.device, gpu.compositeBlock.buffer, ended)
}
