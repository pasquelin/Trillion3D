import { readHeterogeneousVolumeSetting } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import { type WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { type VolumeHoldout } from '../../post/volumeHoldout.ts'
import { HV_BINDING } from './liveShadingProgram.ts'
import { type State, type Targets, bufferOf, composeOf, stepImage } from './liveShadingState.ts'
import { HV_VIEW_BYTES, packView } from './liveShadingView.ts'

/** What the composition reads of the frame: the camera's unprojection numbers and the settings. */
export interface ComposeFrame {
  held: State
  rt: WebgpuPagesRuntime
  device: GPUDevice
  encoder: GPUCommandEncoder
  /** The images the volumes were rendered into, and the one the last volume wrote. */
  target: Targets
  ping: number
  factor: number
  scaled: readonly [number, number]
  settings: (field: Parameters<typeof readHeterogeneousVolumeSetting>[1]) => number
  inverse: ArrayLike<number>
  eye: ArrayLike<number>
  forward: ArrayLike<number>
  depthMap: readonly [number, number]
  /** The holdout the volumes that hold out left, laid in the alpha once the volumes are over the image; none where there is none. */
  holdout?: VolumeHoldout
  /** The beer map of the camera the last volume wrote, where the volumes are composited with the translucency. */
  cameraMap?: GPUTexture
  perspective: boolean
}

type Composition = NonNullable<ReturnType<typeof composeOf>>

/** The view's uniform of a pass of the composition: the unprojection, the rectangle it covers, the factor it reads the image by (`ratio`), the modes
 *  and the upsampled image's size, and the factor the volumes were rendered at (`svt1.z`, which the beer map is read by). */
function composeView(
  c: ComposeFrame,
  name: string,
  rect: readonly [number, number],
  ratio: number,
  words: ArrayLike<number>,
) {
  const buffer = bufferOf(
    c.held,
    c.device,
    name,
    HV_VIEW_BYTES,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  c.device.queue.writeBuffer(
    buffer,
    0,
    packView(
      {
        inverseViewProj: c.inverse,
        eye: c.eye,
        forward: c.forward,
        depthMap: c.depthMap,
        perspective: c.perspective,
      },
      [0, 0, rect[0], rect[1]],
      [1, 1],
      [0, 0],
      [0, ratio, 0, 0],
      words,
    ),
  )
  return buffer
}

/** One pass of the composition into `view`: the image `from` read by `pipeline`, and, for the pass that reads the camera's beer map, that map and the depth. */
function drawCompose(
  c: ComposeFrame,
  compose: Composition,
  pass: {
    name: string
    pipeline: GPURenderPipeline
    view: GPUTextureView
    from: GPUTexture
    rect: readonly [number, number]
    ratio: number
    modes: readonly number[]
    load: GPULoadOp
    beer?: GPUTexture
  },
) {
  const { device, encoder, held, rt } = c
  const buffer = composeView(c, pass.name, pass.rect, pass.ratio, [
    pass.modes[0],
    pass.modes[1],
    pass.modes[2],
    0,
    pass.rect[0],
    pass.rect[1],
    c.factor,
    0,
  ])
  const render = encoder.beginRenderPass({
    label: 'Trillion3D heterogeneous volume compose',
    colorAttachments: [
      { view: pass.view, loadOp: pass.load, storeOp: 'store', clearValue: [0, 0, 0, 1] },
    ],
  })
  render.setPipeline(pass.pipeline)
  render.setBindGroup(
    0,
    device.createBindGroup({
      layout: pass.beer ? compose.beerLayout : compose.layout,
      entries: [
        { binding: HV_BINDING.view, resource: { buffer } },
        { binding: HV_BINDING.sampler, resource: held.sampler! },
        { binding: HV_BINDING.composeIn, resource: pass.from.createView() },
        ...(pass.beer
          ? [
              { binding: HV_BINDING.depth, resource: rt.gpu.depthView! },
              { binding: HV_BINDING.beerPrevious, resource: pass.beer.createView() },
            ]
          : []),
      ],
    }),
  )
  render.draw(3)
  render.end()
}

/** The opacity of the volumes that hold out added to the alpha, read over the whole factor of the downsampling. */
function layHoldout(c: ComposeFrame, compose: Composition, holdout: VolumeHoldout) {
  const { rt, device, encoder } = c
  const { gpu } = rt
  const buffer = composeView(
    c,
    'holdout view',
    [gpu.targetSize[0], gpu.targetSize[1]],
    c.factor,
    [0, 0, 0, 0, 0, 0, 0, 0],
  )
  const render = encoder.beginRenderPass({
    label: 'Trillion3D heterogeneous volume holdout',
    colorAttachments: [{ view: gpu.hdrView!, loadOp: 'load', storeOp: 'store' }],
  })
  render.setPipeline(compose.holdout!)
  render.setBindGroup(
    0,
    device.createBindGroup({
      layout: compose.holdoutLayout,
      entries: [
        { binding: HV_BINDING.view, resource: { buffer } },
        { binding: HV_BINDING.holdoutIn, resource: holdout.view },
      ],
    }),
  )
  render.draw(3)
  render.end()
}

/** The volumes' image brought back to the view's size by steps and laid over the lit image. */
export function composeVolumes(c: ComposeFrame) {
  const { held, rt, device, target, ping, factor, scaled, settings, holdout, cameraMap } = c
  const { gpu } = rt
  const size = gpu.targetSize
  if (!gpu.hdrTexture || !gpu.hdrView) return
  const compose = composeOf(held, rt, device, gpu.hdrTexture.format)
  if (!compose.pipeline || !compose.upsample || (cameraMap && !compose.beer)) return
  // The image is brought back to the view's size by steps of 3 or 2 (the reference iterates the same way),
  // each upsampled and, where the setting asks, filtered; the last is laid over the lit image.
  const modes = [
    Math.max(settings('heterogeneousVolumesUpsample'), 1),
    settings('heterogeneousVolumesFilter'),
    settings('heterogeneousVolumesFilterWidth'),
  ]
  const iterate = settings('heterogeneousVolumesUpsample') !== 0
  let source = target.images[ping]
  let step = factor
  let drawn = 0
  while (iterate && step > 1) {
    const by = step % 3 === 0 ? 3 : 2
    const rect: [number, number] = [Math.ceil(size[0] / step) * by, Math.ceil(size[1] / step) * by]
    const next = stepImage(held, device, `step ${drawn}`, rect)
    drawCompose(c, compose, {
      name: `compose ${drawn++}`,
      pipeline: compose.upsample,
      view: next.createView(),
      from: source,
      rect,
      ratio: by,
      modes,
      load: 'clear',
    })
    source = next
    step = Math.floor(step / by)
  }
  // What is left of the factor (all of it where the upsampling is off) is read as the nearest pixel.
  const beer = cameraMap && compose.beer ? cameraMap : undefined
  drawCompose(c, compose, {
    name: `compose ${drawn}`,
    pipeline: beer ? compose.beer! : compose.pipeline,
    view: gpu.hdrView,
    from: source,
    rect: [size[0], size[1]],
    ratio: step,
    modes: [1, 0, 0],
    load: 'load',
    beer,
  })
  if (holdout && compose.holdout) layHoldout(c, compose, holdout)
}
