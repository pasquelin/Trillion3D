import { DEPTH_COMPARE_OR_EQUAL } from '../camera/depthConvention.ts'
import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import {
  HAIR_MSAA_SAMPLES,
  HAIR_MSAA_SHIFT,
  HAIR_MSAA_VIS_FORMAT,
  hairMsaaPasses,
  MSAA_FILL_WGSL,
  MSAA_WGSL,
  msaaResolveWgsl,
} from './msaaWgsl.ts'
import { clearSamplesPipeline, type HairBandBuffers } from './rasterPass.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import type { HairTiles } from './tilesPass.ts'
import { SEGMENT_VERTICES } from './transmittanceWgsl.ts'
import {
  HAIR_ALL_TILES_DISPATCH,
  HAIR_ALL_TILES_DRAW,
  type HairSampleCount,
} from './visibilityMath.ts'

const shaderModule = oncePerDevice((device) => device.createShaderModule({ code: MSAA_WGSL }))
const fillModule = oncePerDevice((device) => device.createShaderModule({ code: MSAA_FILL_WGSL }))

const TRIANGLES: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' }
const MULTISAMPLE: GPUMultisampleState = { count: HAIR_MSAA_SAMPLES }

/** The pipeline that draws the ribbons of pass `pass` of a pixel's samples: the second is moved by
 *  `HAIR_MSAA_SHIFT`. The depth unit keeps the nearer or equal, against the opaque depth written first. */
const drawPipelines = oncePerDevice((device) =>
  [0, 1].map((pass) => {
    const module = shaderModule(device)
    return preparedPipeline(device, {
      label: `${HAIR_STRANDS_PASS_PREFIX}visibility draw ${pass}`,
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'hairVisibilityVs',
        constants: { SHIFT_X: HAIR_MSAA_SHIFT[0] * pass, SHIFT_Y: HAIR_MSAA_SHIFT[1] * pass },
      },
      fragment: {
        module,
        entryPoint: 'hairVisibilityFs',
        targets: [{ format: HAIR_MSAA_VIS_FORMAT }],
      },
      primitive: TRIANGLES,
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: DEPTH_COMPARE_OR_EQUAL,
      },
      multisample: MULTISAMPLE,
    })
  }),
)

/** The pipeline that writes the opaque depth into every sample of the depth target, over the tiles with strands. */
const fillPipeline = oncePerDevice((device) => {
  const module = fillModule(device)
  return preparedPipeline(device, {
    label: `${HAIR_STRANDS_PASS_PREFIX}visibility fill opaque depth`,
    layout: 'auto',
    vertex: { module, entryPoint: 'hairTileQuadVs' },
    fragment: { module, entryPoint: 'hairFillFs', targets: [{ format: HAIR_MSAA_VIS_FORMAT }] },
    primitive: TRIANGLES,
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' },
    multisample: MULTISAMPLE,
  })
})

/** The resolve of pass `pass` into the samples of a band, by sample count and whether the device has
 *  the 64-bit maximum. */
const resolveKernels = preparedPipelines(
  ({ samples, wide, pass }: { samples: HairSampleCount; wide: boolean; pass: number }) =>
    autoKernel(
      `${HAIR_STRANDS_PASS_PREFIX}visibility resolve ${samples} ${wide ? 'wide' : 'split'} ${pass}`,
      msaaResolveWgsl(samples, wide),
      'hairMsaaResolve',
      { PASS: pass },
    ),
  ({ samples, wide, pass }) => `${samples} ${wide} ${pass}`,
)

/** The pipelines of the hardware raster for `samples` samples a pixel: the fill of the opaque depth and,
 *  for each pass of four samples, the draw and the resolve, and the clear of the samples; none while one
 *  compiles. */
export function msaaPipelines(device: GPUDevice, samples: HairSampleCount, wide: boolean) {
  const fill = fillPipeline(device).get()
  const draws = drawPipelines(device)
  const passes = Array.from({ length: hairMsaaPasses(samples) }, (_, pass) => ({
    draw: draws[pass]!.get(),
    resolve: resolveKernels.of({ samples, wide, pass })(device).get(),
  }))
  const clear = clearSamplesPipeline(device, samples, wide)
  return fill && clear && passes.every(({ draw, resolve }) => draw && resolve)
    ? {
        fill,
        clear,
        passes: passes as { draw: GPURenderPipeline; resolve: GPUComputePipeline }[],
      }
    : undefined
}

/** The multisampled targets of an image: the depth and the identifiers of the strands. */
interface HairMsaaTargets {
  readonly msaaDepthView: GPUTextureView
  readonly msaaVisView: GPUTextureView
  /** The pass that draws into them: cleared, then the opaque depth, then the ribbons. */
  readonly msaaPass: GPURenderPassDescriptor & {
    depthStencilAttachment: GPURenderPassDepthStencilAttachment
  }
}

/** The multisampled targets with the bind groups of the draws. */
type HairMsaaSet = HairMsaaTargets & { readonly msaaBinds: ReturnType<typeof msaaBinds> }

/** The pass over the multisampled `depth` and `vis` views. */
export const hairMsaaPass = (
  depth: GPUTextureView,
  vis: GPUTextureView,
): HairMsaaTargets['msaaPass'] => ({
  label: `${HAIR_STRANDS_PASS_PREFIX}visibility draw`,
  colorAttachments: [
    { view: vis, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
  ],
  depthStencilAttachment: {
    view: depth,
    depthClearValue: 0,
    depthLoadOp: 'clear',
    depthStoreOp: 'store',
  },
})

/** The bind groups of the hardware raster, kept while the resources they name stay. */
export function msaaBinds() {
  return {
    draw: boundGroups<GPUBuffer, undefined, undefined>(2, (device, pipeline, view) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
        entries: sequentialEntries([{ buffer: view }]),
      }),
    ),
    fill: boundGroups<GPUBuffer, HairTiles, GPUTextureView>(
      1,
      (device, pipeline, image, tiles, depth) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: image } },
            { binding: 1, resource: { buffer: tiles.data } },
            { binding: 2, resource: depth },
          ],
        }),
    ),
  }
}

/** The bind groups of the resolve over one band. */
export function msaaResolveBinds() {
  return boundGroups<
    Pick<HairTiles, 'counts' | 'data'>,
    HairBandBuffers,
    Pick<HairMsaaTargets, 'msaaDepthView' | 'msaaVisView'>,
    GPUBuffer
  >(2, (device, pipeline, tiles, band, targets, image) =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: sequentialEntries([
        { buffer: image },
        { buffer: tiles.counts },
        { buffer: tiles.data },
        { buffer: band.samples },
        { buffer: band.window },
        targets.msaaDepthView,
        targets.msaaVisView,
      ]),
    }),
  )
}

/** What the hardware raster reads of the image. */
interface HairMsaaFrame {
  readonly viewBuffer: GPUBuffer
  /** The opaque depth, written into the depth target first. */
  readonly depthView: GPUTextureView
  /** The image block (`HAIR_IMAGE_WGSL`). */
  readonly image: GPUBuffer
  readonly size: readonly [number, number]
  /** The pixels the strands cover: `[x0, y0, x1, y1]`. */
  readonly rect: readonly [number, number, number, number]
}

/**
 * Draws the visibility of `drawn` by the hardware raster, a pass of four samples after another: the
 * opaque depth written into every sample, the ribbons drawn over the rectangle of the strands against
 * it (a render pass of `encoder`), then the samples they wrote placed in the bands' buffer, in the
 * tiles with strands (a compute pass). `bands` are the bands of the samples, `count` of them reached.
 */
export function encodeHairMsaa(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: NonNullable<ReturnType<typeof msaaPipelines>>,
  targets: HairMsaaSet,
  frame: HairMsaaFrame,
  drawn: readonly DrawnInstance[],
  tiles: HairTiles,
  bands: readonly (HairBandBuffers & { readonly resolve: ReturnType<typeof msaaResolveBinds> })[],
  count: number,
) {
  if (!drawn.length || count === 0) return
  const { size, rect } = frame
  for (let pass = 0; pass < pipelines.passes.length; pass++) {
    const { draw, resolve } = pipelines.passes[pass]!
    const render = encoder.beginRenderPass(targets.msaaPass)
    render.setViewport(0, 0, size[0], size[1], 0, 1)
    render.setScissorRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])
    render.setPipeline(pipelines.fill)
    render.setBindGroup(
      0,
      targets.msaaBinds.fill(device, pipelines.fill, frame.image, tiles, frame.depthView),
    )
    render.drawIndirect(tiles.drawArgs, HAIR_ALL_TILES_DRAW)
    render.setPipeline(draw)
    render.setBindGroup(
      1,
      targets.msaaBinds.draw(device, draw, frame.viewBuffer, undefined, undefined),
    )
    for (const instance of drawn) {
      render.setBindGroup(0, instance.group(draw))
      render.draw(instance.pointCount * SEGMENT_VERTICES)
    }
    render.end()
    const compute = encoder.beginComputePass({
      label: `${HAIR_STRANDS_PASS_PREFIX}visibility resolve`,
    })
    compute.setPipeline(resolve)
    for (let k = 0; k < count; k++) {
      const band = bands[k]!
      compute.setBindGroup(0, band.resolve(device, resolve, tiles, band, targets, frame.image))
      compute.dispatchWorkgroupsIndirect(tiles.dispatchArgs, HAIR_ALL_TILES_DISPATCH)
    }
    compute.end()
  }
}
