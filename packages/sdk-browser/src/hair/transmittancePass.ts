import { DEPTH_COMPARE_OR_EQUAL } from '../camera/depthConvention.ts'
import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import type { ResourceAllocator } from '../gpu/core/resourceAllocator.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import {
  CLEAR_TARGETS_WGSL,
  RESOLVE_WGSL,
  SEGMENT_VERTICES,
  TRANSMITTANCE_WGSL,
} from './transmittanceWgsl.ts'
import {
  HAIR_COVERAGE_FORMAT,
  HAIR_NODE_INDEX_FORMAT,
  HAIR_ONLY_DEPTH_FORMAT,
  HAIR_TILE_SIZE,
  HAIR_TRANSMITTANCE_FORMAT,
} from './visibilityMath.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

/** The target of an image the pass writes nothing to but clears: the depth of the nearest strand. */
const CLEARED_TARGET: GPUColorTargetState = { format: HAIR_ONLY_DEPTH_FORMAT, writeMask: 0 }

const shaderModule = oncePerDevice((device) =>
  device.createShaderModule({ code: TRANSMITTANCE_WGSL }),
)
const clearModule = oncePerDevice((device) =>
  device.createShaderModule({ code: CLEAR_TARGETS_WGSL }),
)

/** The depth unit of the passes over the image: read only, the strands behind the opaque depth
 *  dropped where `compare` says. */
const readOnlyDepth = (compare: GPUCompareFunction): GPUDepthStencilState => ({
  format: DEPTH_FORMAT,
  depthWriteEnabled: false,
  depthCompare: compare,
})

const drawPipeline = (device: GPUDevice, blendable: boolean) => {
  const module = shaderModule(device)
  return preparedPipeline(device, {
    label: `${HAIR_STRANDS_PASS_PREFIX}transmittance ${blendable ? 'blend' : 'product'}`,
    layout: 'auto',
    vertex: { module, entryPoint: 'hairTransmittanceVs' },
    fragment: {
      module,
      entryPoint: blendable ? 'hairTransmittanceBlend' : 'hairTransmittanceProduct',
      targets: [
        blendable
          ? {
              format: HAIR_TRANSMITTANCE_FORMAT,
              writeMask: GPUColorWrite.RED,
              blend: {
                color: { operation: 'add', srcFactor: 'dst', dstFactor: 'zero' },
                alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'zero' },
              },
            }
          : { format: HAIR_TRANSMITTANCE_FORMAT, writeMask: 0 },
        CLEARED_TARGET,
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    // The depth unit drops what lies behind the opaque surface; the product's shader does.
    depthStencil: readOnlyDepth(blendable ? DEPTH_COMPARE_OR_EQUAL : 'always'),
  })
}
const blendPipeline = oncePerDevice((device) => drawPipeline(device, true))
const productPipeline = oncePerDevice((device) => drawPipeline(device, false))
/** The clear of the transmittance within a rectangle. */
const clearPipeline = oncePerDevice((device) => {
  const module = clearModule(device)
  return preparedPipeline(device, {
    label: `${HAIR_STRANDS_PASS_PREFIX}clear targets`,
    layout: 'auto',
    vertex: { module, entryPoint: 'hairClearTargetsVs' },
    fragment: {
      module,
      entryPoint: 'hairClearTargetsFs',
      targets: [{ format: HAIR_TRANSMITTANCE_FORMAT }, CLEARED_TARGET],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: readOnlyDepth('always'),
  })
})
const resolveKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}transmittance resolve`,
  RESOLVE_WGSL,
  'hairTransmittanceResolve',
)

/** The pipelines the transmittance draws with, none while one compiles: the clear of the targets, the
 *  draw, and for the product in a buffer the resolve of it. */
export function transmittancePipelines(device: GPUDevice, blendable: boolean) {
  const clear = clearPipeline(device).get()
  const draw = (blendable ? blendPipeline : productPipeline)(device).get()
  const resolve = blendable ? undefined : resolveKernel(device).get()
  return clear && draw && (blendable || resolve) ? { clear, draw, resolve } : undefined
}

/** The bind groups of the transmittance, kept while the resources they name stay. */
function transmittanceBinds() {
  return {
    frame: boundGroups<GPUBuffer, GPUTextureView, GPUBuffer | undefined>(
      1,
      (device, pipeline, view, depth, bits) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: sequentialEntries(
            bits ? [{ buffer: view }, depth, { buffer: bits }] : [{ buffer: view }],
          ),
        }),
    ),
    resolve: boundGroups<GPUBuffer, GPUBuffer, GPUTextureView>(
      1,
      (device, pipeline, image, bits, transmittance) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: sequentialEntries([{ buffer: image }, { buffer: bits }, transmittance]),
        }),
    ),
  }
}

const ONE = { r: 1, g: 0, b: 0, a: 0 }
const ZERO = { r: 0, g: 0, b: 0, a: 0 }

/** The textures of an image, named to `allocator`, all of the size `width` by `height` the opaque depth
 *  was made at (a pass draws into them beside it), and what the transmittance of a device without
 *  32-bit float blending needs: the transmittance of the strands, a pixel's descriptor of its
 *  compacted samples, the share of the pixel the strands cover, the depth of the nearest strand
 *  (`hairOnlyDepth`, written by the pass after the material) and the product's buffer, a word a pixel,
 *  none with the blend unit. `readback` is the usage a proof that reads them back adds
 *  (`HairViewGpu.readback`). */
export function allocateHairImageTargets(
  allocator: ResourceAllocator,
  width: number,
  height: number,
  blendable: boolean,
  readback: GPUTextureUsageFlags,
) {
  const written = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | readback
  // The transmittance and the depth of the nearest strand are the pass's attachments too.
  const image = (label: string, format: GPUTextureFormat, attached: boolean) =>
    allocator.image(label, [width, height], format, {
      usage: attached ? written | GPUTextureUsage.RENDER_ATTACHMENT : written,
    })
  return {
    transmittance: image('transmittance', HAIR_TRANSMITTANCE_FORMAT, true),
    nodeIndex: image('node index', HAIR_NODE_INDEX_FORMAT, false),
    coverage: image('coverage', HAIR_COVERAGE_FORMAT, false),
    hairOnlyDepth: image('depth of the nearest strand', HAIR_ONLY_DEPTH_FORMAT, true),
    bits: blendable
      ? undefined
      : allocator.buffer('transmittance product', width * height, 'storage'),
  }
}

/**
 * The views of the targets, the bind groups of the passes over them, and the pass's descriptor, made
 * once with them (its depth view is the image's, set in place for each). The pass clears the depth of
 * the nearest strand whole, as the image's other pixels hold no strand: the passes after the material
 * write it in the tiles with strands. The descriptors and the coverage are left to the compaction, which
 * writes every pixel of those tiles: every reader of them goes through the tiles.
 */
export function extendHairImageTargets(targets: ReturnType<typeof allocateHairImageTargets>) {
  const { transmittance, nodeIndex, coverage, hairOnlyDepth, bits } = targets
  const transmittanceView = transmittance.createView()
  const hairOnlyDepthView = hairOnlyDepth.createView()
  const attachments: GPURenderPassColorAttachment[] = [
    {
      view: transmittanceView,
      clearValue: ONE,
      loadOp: 'load',
      storeOp: bits ? 'discard' : 'store',
    },
    { view: hairOnlyDepthView, clearValue: ZERO, loadOp: 'clear', storeOp: 'store' },
  ]
  const depthStencilAttachment: GPURenderPassDepthStencilAttachment = {
    view: undefined as never,
    depthReadOnly: true,
  }
  return {
    blendable: !bits,
    transmittanceView,
    nodeIndexView: nodeIndex.createView(),
    coverageView: coverage.createView(),
    hairOnlyDepthView,
    binds: transmittanceBinds(),
    pass: {
      label: `${HAIR_STRANDS_PASS_PREFIX}transmittance`,
      colorAttachments: attachments,
      depthStencilAttachment,
    } satisfies GPURenderPassDescriptor,
    depthStencilAttachment,
  }
}

/** The targets of an image (`allocateHairImageTargets`, `extendHairImageTargets`). */
export type HairImageTargets = ReturnType<typeof allocateHairImageTargets> &
  ReturnType<typeof extendHairImageTargets>

/** The rectangle of pixels the strands cover, or of the tiles that hold them: `[x0, y0, x1, y1]`. */
type Rect = readonly [number, number, number, number]

/** What a draw of the transmittance reads of the image. */
interface HairTransmittanceFrame {
  /** The view block (`HAIR_VIEW_WGSL`). */
  readonly viewBuffer: GPUBuffer
  /** The opaque depth, which the pass tests against (read only) beside the targets. */
  readonly depthView: GPUTextureView
  /** The image block (`HAIR_IMAGE_WGSL`). */
  readonly image: GPUBuffer
  /** The size of the image drawn, in pixels. */
  readonly size: readonly [number, number]
  /** The pixels the strands cover, and the tiles that hold them. */
  readonly rect: Rect
  readonly tiles: Rect
}

/**
 * Draws the ribbons of `drawn` into the transmittance of `targets`, in a pass of `encoder`: the
 * transmittance cleared within the tiles of the strands' rectangle (the pixels outside them are read by
 * no pass), then the ribbons over the rectangle `frame.rect`, tested against the opaque depth. Without
 * the blend unit the buffer is cleared over the tiles' rows first and its product resolved after, in
 * a pass of its own, over the tiles of the rectangle.
 */
export function encodeTransmittance(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: NonNullable<ReturnType<typeof transmittancePipelines>>,
  targets: HairImageTargets,
  frame: HairTransmittanceFrame,
  drawn: readonly DrawnInstance[],
) {
  const { bits } = targets
  const { size, rect, tiles } = frame
  // The pixels of the tiles of the rectangle: the tiles are classified, and the product resolved, over
  // all of them.
  const x1 = Math.min(size[0], tiles[2] * HAIR_TILE_SIZE),
    y0 = tiles[1] * HAIR_TILE_SIZE,
    y1 = Math.min(size[1], tiles[3] * HAIR_TILE_SIZE)
  if (bits) encoder.clearBuffer(bits, y0 * size[0] * 4, (y1 - y0) * size[0] * 4)
  targets.depthStencilAttachment.view = frame.depthView
  const pass = encoder.beginRenderPass(targets.pass)
  pass.setViewport(0, 0, size[0], size[1], 0, 1)
  const x0 = tiles[0] * HAIR_TILE_SIZE
  pass.setScissorRect(x0, y0, x1 - x0, y1 - y0)
  pass.setPipeline(pipelines.clear)
  pass.draw(3)
  pass.setScissorRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])
  pass.setPipeline(pipelines.draw)
  pass.setBindGroup(
    1,
    targets.binds.frame(device, pipelines.draw, frame.viewBuffer, frame.depthView, bits),
  )
  for (const instance of drawn) {
    pass.setBindGroup(0, instance.group(pipelines.draw))
    pass.draw(instance.pointCount * SEGMENT_VERTICES)
  }
  pass.end()
  if (!bits || !pipelines.resolve) return
  const resolve = encoder.beginComputePass({
    label: `${HAIR_STRANDS_PASS_PREFIX}transmittance resolve`,
  })
  resolve.setPipeline(pipelines.resolve)
  resolve.setBindGroup(
    0,
    targets.binds.resolve(device, pipelines.resolve, frame.image, bits, targets.transmittanceView),
  )
  resolve.dispatchWorkgroups(tiles[2] - tiles[0], tiles[3] - tiles[1])
  resolve.end()
}
