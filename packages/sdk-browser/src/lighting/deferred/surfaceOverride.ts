import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { FLAGS_VIEW, SURFACE_COLOURS_FORMAT } from '../../materials/surface/surfaceOutputs.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import type { ViewOverrides } from '../../frame/backend/state/viewOverrides.ts'
import { fullscreenDescriptor, preparedPipeline } from './fullscreen.ts'
import { REWRITE_CODE } from './surfaceRewriteWgsl.ts'

/**
 * THE SURFACE REWRITE of a view that overrides its surfaces (`ViewOverrides`): before any light
 * reads them, the roughness of every lit pixel becomes `saturate(r) * range + min` and its diffuse
 * colour `colour * w + xyz`, the lit models' pixels alone (a pixel that shows something other than
 * light, an unlit one or the background keeps its texels). A pass of its own over the surface
 * layers, encoded for such a view only: the main view's lighting programs read the surfaces as
 * they are, and no word of the overrides.
 *
 * The layers cannot be read and written by one pass: their first two are copied to a texture of
 * the same size first, the rewrite reads that copy and writes the layers back.
 */
const WORDS = 8

/** What is made once for a device, and the copy of the surfaces last rewritten. */
interface Rewriter {
  readonly pipeline: ReturnType<typeof preparedPipeline>
  readonly layout: GPUBindGroupLayout
  readonly block: GPUBuffer
  readonly words: Float32Array<ArrayBuffer>
  held?: Held
}
/** The rewrite's pass, held: its attachments are those of the surfaces. */
const REWRITE: GPURenderPassDescriptor = {
  label: 'Trillion3D surface rewrite',
  colorAttachments: [],
}

/** The copy of two layers of `of`, the group over it and the layers it writes back. */
interface Held {
  readonly of: SurfaceBuffer
  readonly copy: GPUTexture
  readonly group: GPUBindGroup
  readonly targets: readonly GPURenderPassColorAttachment[]
}
const REWRITERS = new WeakMap<GPUDevice, Promise<Rewriter>>()
const MADE = new WeakMap<GPUDevice, Rewriter>()

function createRewriter(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'uint', viewDimension: '2d' },
      },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  })
  return createCheckedShaderModule(device, REWRITE_CODE, 'Trillion3D surface rewrite').then(
    (module) => {
      const target: GPUColorTargetState = { format: SURFACE_COLOURS_FORMAT }
      const pipeline = preparedPipeline(
        device,
        fullscreenDescriptor(
          device,
          module,
          layout,
          'rewriteSurface',
          [target, target],
          'Trillion3D surface rewrite',
        ),
      )
      return pipeline.prepare().then(() => {
        const made: Rewriter = {
          pipeline,
          layout,
          block: device.createBuffer({
            label: 'Trillion3D surface rewrite block',
            size: WORDS * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          }),
          words: new Float32Array(new ArrayBuffer(WORDS * 4)),
        }
        MADE.set(device, made)
        return made
      })
    },
  )
}

/** Compiles the rewrite once, ahead of the images that encode it. */
export function prepareSurfaceRewrite(device: GPUDevice) {
  let made = REWRITERS.get(device)
  if (!made) REWRITERS.set(device, (made = createRewriter(device)))
  return made.then(() => undefined)
}

/** Gives back the copy of the surfaces last rewritten: the view they belonged to is released. */
export function releaseSurfaceRewrite(device: GPUDevice) {
  const made = MADE.get(device)
  if (made?.held) retire(device, made.held.copy)
  if (made) made.held = undefined
}

function heldOf(device: GPUDevice, made: Rewriter, surfaces: SurfaceBuffer) {
  if (made.held?.of === surfaces) return made.held
  releaseSurfaceRewrite(device)
  const copy = device.createTexture({
    label: 'Trillion3D surface rewrite copy',
    size: [surfaces.width, surfaces.height, 2],
    format: SURFACE_COLOURS_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const layer = (at: number) =>
    surfaces.colours.createView({ dimension: '2d', baseArrayLayer: at, arrayLayerCount: 1 })
  return (made.held = {
    of: surfaces,
    copy,
    group: device.createBindGroup({
      layout: made.layout,
      entries: [
        { binding: 0, resource: copy.createView({ dimension: '2d-array' }) },
        { binding: 1, resource: surfaces.views()[FLAGS_VIEW] },
        { binding: 2, resource: { buffer: made.block } },
      ],
    }),
    targets: [0, 1].map((at) => ({ view: layer(at), loadOp: 'load', storeOp: 'store' })),
  })
}

/** The roughness and the diffuse colour of `surfaces` rewritten as `overrides` say, ahead of the
 *  lighting; `prepareSurfaceRewrite` having landed. */
export function encodeSurfaceRewrite(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  surfaces: SurfaceBuffer,
  overrides: ViewOverrides,
) {
  const made = MADE.get(device)
  if (!made) throw new Error('SURFACE_REWRITE_NOT_PREPARED')
  const held = heldOf(device, made, surfaces)
  const { roughness, diffuse } = overrides
  REWRITE.colorAttachments = held.targets
  made.words.set(diffuse ?? [0, 0, 0, 1], 0)
  made.words.set(roughness ? [roughness.min, roughness.range, 1, 0] : [0, 1, 0, 0], 4)
  device.queue.writeBuffer(made.block, 0, made.words)
  encoder.copyTextureToTexture(
    { texture: surfaces.colours },
    { texture: held.copy },
    { width: surfaces.width, height: surfaces.height, depthOrArrayLayers: 2 },
  )
  drawFullscreenTriangle(encoder, REWRITE, made.pipeline.get(), held.group)
}
