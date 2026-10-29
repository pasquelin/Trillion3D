import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import { HAIR_DEPTH_WGSL, hairGbufferWgsl } from './gbufferWgsl.ts'
import { boundGroups } from './ribbonBinds.ts'
import type { HairNodes } from './compactionPass.ts'
import type { HairTiles } from './tilesPass.ts'
import { HAIR_ALL_TILES_DISPATCH, HAIR_ALL_TILES_DRAW } from './visibilityMath.ts'

const onlyDepthKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}depth of the nearest strand`,
  hairGbufferWgsl(false),
  'hairGbuffer',
)
const surfaceKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}depth of the nearest strand and surfaces under full coverage`,
  hairGbufferWgsl(true),
  'hairGbuffer',
)
const depthModule = oncePerDevice((device) => device.createShaderModule({ code: HAIR_DEPTH_WGSL }))
const depthPipeline = oncePerDevice((device) => {
  const module = depthModule(device)
  return preparedPipeline(device, {
    label: `${HAIR_STRANDS_PASS_PREFIX}depth under full coverage`,
    layout: 'auto',
    vertex: { module, entryPoint: 'hairTileQuadVs' },
    fragment: { module, entryPoint: 'hairDepthFs', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    // The depth is written wherever the fragment is kept: the strands' is the surface's there.
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' },
  })
})

/** The pipelines of the passes after the material: the depth of the nearest strand alone, or with the
 *  patch of the surfaces and of their depth where the surfaces are handed (`patch`); none while one
 *  compiles. */
export function gbufferPipelines(device: GPUDevice, patch: boolean) {
  if (!patch) {
    const walk = onlyDepthKernel(device).get()
    return walk && { walk, depth: undefined }
  }
  const walk = surfaceKernel(device).get()
  const depth = depthPipeline(device).get()
  return walk && depth ? { walk, depth } : undefined
}

/** The surfaces' storage views the patch writes: the colours' and the words' (`SurfaceBuffer.stores`). */
type HairSurfaceStores = readonly [GPUTextureView, GPUTextureView]

/** The textures of the image the passes read and write (`HairImageTargets`). */
interface HairGbufferTargets {
  readonly nodeIndexView: GPUTextureView
  readonly coverageView: GPUTextureView
  readonly hairOnlyDepthView: GPUTextureView
}

/** The bind groups of the passes after the material, kept while the resources they name stay; `image`
 *  is the view's image block. */
export function gbufferBinds(image: GPUBuffer) {
  const walked = (tiles: HairTiles, nodes: HairNodes, targets: HairGbufferTargets) => [
    { buffer: image },
    { buffer: tiles.counts },
    { buffer: tiles.data },
    targets.nodeIndexView,
    { buffer: nodes.nodeData },
    targets.hairOnlyDepthView,
  ]
  return {
    walk: boundGroups<HairTiles, HairNodes, HairGbufferTargets, HairSurfaceStores>(
      1,
      (device, pipeline, tiles, nodes, targets, stores) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: sequentialEntries(
            stores
              ? [...walked(tiles, nodes, targets), targets.coverageView, stores[0], stores[1]]
              : walked(tiles, nodes, targets),
          ),
        }),
    ),
    depth: boundGroups<HairTiles, HairNodes, HairGbufferTargets>(
      1,
      (device, pipeline, tiles, nodes, targets) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: sequentialEntries([
            { buffer: image },
            { buffer: tiles.data },
            targets.nodeIndexView,
            { buffer: nodes.nodeData },
            targets.coverageView,
          ]),
        }),
    ),
  }
}

/**
 * Writes, in the compute `pass`, the depth of the nearest strand of every pixel of the tiles with
 * strands and, where `stores` (the surfaces) are given, empties in the same walk the surfaces the
 * strands cover wholly (`hairGbufferWgsl`).
 */
export function encodeHairGbuffer(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipelines: NonNullable<ReturnType<typeof gbufferPipelines>>,
  binds: ReturnType<typeof gbufferBinds>,
  tiles: HairTiles,
  nodes: HairNodes,
  targets: HairGbufferTargets,
  stores: HairSurfaceStores | undefined,
) {
  pass.setPipeline(pipelines.walk)
  pass.setBindGroup(0, binds.walk(device, pipelines.walk, tiles, nodes, targets, stores))
  pass.dispatchWorkgroupsIndirect(tiles.dispatchArgs, HAIR_ALL_TILES_DISPATCH)
}

/** The pass that writes the depth of the surfaces the strands cover wholly: its descriptor, its depth
 *  view set in place for each image. */
export const gbufferDepthPass = (): GPURenderPassDescriptor & {
  depthStencilAttachment: GPURenderPassDepthStencilAttachment
} => ({
  label: `${HAIR_STRANDS_PASS_PREFIX}depth under full coverage`,
  colorAttachments: [],
  depthStencilAttachment: { view: undefined as never, depthLoadOp: 'load', depthStoreOp: 'store' },
})

/** Draws the tiles with strands in `pass`, a render pass of `gbufferDepthPass`, over an image of `size`:
 *  the depth of the surfaces under full coverage becomes the strands' (`HAIR_DEPTH_WGSL`). */
export function encodeHairDepth(
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  pipeline: GPURenderPipeline,
  binds: ReturnType<typeof gbufferBinds>,
  tiles: HairTiles,
  nodes: HairNodes,
  targets: HairGbufferTargets,
  size: readonly [number, number],
) {
  pass.setViewport(0, 0, size[0], size[1], 0, 1)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, binds.depth(device, pipeline, tiles, nodes, targets))
  pass.drawIndirect(tiles.drawArgs, HAIR_ALL_TILES_DRAW)
}
