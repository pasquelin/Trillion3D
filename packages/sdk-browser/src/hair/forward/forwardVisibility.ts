import { ensureSet } from '../../gpu/core/heldTextures.ts'
import { storageBufferCap } from '../../session/memory/pools.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../../diagnostic/stage/passLabels.ts'
import { encodeHairNodeArgs } from '../compactionPass.ts'
import { encodeHairMaterial } from '../materialPass.ts'
import { HAIR_RASTER_DEFAULTS } from '../rasterModes.ts'
import { encodeHairTiles } from '../tilesPass.ts'
import { tellHairOnce, type HairViewGpu, type HairViewRecord } from '../viewGpu.ts'
import type { HairPrograms } from '../visibility.ts'
import {
  allocateForward,
  clearForward,
  encodeForwardColor,
  encodeForwardVisibility,
  extendForward,
  forwardPipelines,
  sendForwardParams,
  type ForwardResources,
  type Sources,
} from './forwardPass.ts'
import { forwardLayout } from './forwardMath.ts'

/** The strands' targets and buffers the forward raster reads and writes. */
const sourcesOf = (gpu: HairViewGpu, { targets, nodes }: HairViewRecord): Sources => ({
  view: gpu.viewBlock.buffer,
  sceneDepth: gpu.inputs.depthView!,
  nodes,
  transmittance: targets.transmittanceView,
  hairDepth: targets.hairOnlyDepthView,
  coverage: targets.coverageView,
})

/** The forward raster's resources for this image, kept or made, with its layout and parameters of the image; none (said once) where the device refuses them. */
function ensureForwardResources(
  device: GPUDevice,
  gpu: HairViewGpu,
  record: HairViewRecord,
  fail: (error: unknown) => void,
) {
  const { inputs } = gpu
  const layout = forwardLayout(
    inputs.size,
    inputs.raster ?? HAIR_RASTER_DEFAULTS,
    storageBufferCap(device.limits),
  )
  if (!layout) {
    tellHairOnce(
      gpu,
      'forward',
      `an image of ${inputs.size} pixels is past what the forward raster tiles`,
      fail,
    )
    return undefined
  }
  const capacity = record.nodes.capacity
  const made = ensureSet<
    ReturnType<typeof allocateForward>,
    ReturnType<ReturnType<typeof extendForward>>
  >(
    gpu.forward,
    device,
    {
      key: [inputs.size[0], inputs.size[1], layout.numBinners, layout.maxTiles, capacity],
      what: 'the forward raster of the hair strands',
      label: `${HAIR_STRANDS_PASS_PREFIX}forward`,
    },
    (allocator) => allocateForward(allocator, layout, capacity, inputs.size),
    extendForward(layout, capacity),
  )
  gpu.forward = made.resources
  if (!made.resources) {
    tellHairOnce(gpu, 'forward', made.why ?? 'no room for the forward raster', fail)
    return undefined
  }
  made.resources.layout = layout
  sendForwardParams(device, made.resources, inputs.size, inputs.fullCoverage)
  return made.resources
}

/**
 * The visibility of an image drawn by the forward raster, in place of the transmittance, the samples and their compaction: the targets emptied, every
 * control point of the drawn instances a compacted sample (the cull), the segments binned, gathered and ordered by depth, the depth raster (the transmittance, the
 * depth of the nearest strand and the coverage of each pixel, which the tiles, the shadows and the temporal pass read as they read the visibility's), the tiles
 * with strands, and the material of the samples. The colour of the segments is shaded once the points are lit (`encodeHairForwardColor`). Whether it was encoded:
 * not while a program compiles or where the device refuses the resources.
 */
export function encodeHairForward(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  gpu: HairViewGpu,
  record: HairViewRecord,
  programs: HairPrograms,
  fail: (error: unknown) => void,
) {
  const pipelines = forwardPipelines(device)
  const resources = pipelines && ensureForwardResources(device, gpu, record, fail)
  if (!pipelines || !resources) return false
  const { inputs, members, drawn, imageBlock, tileRect } = gpu
  const { buffers, nodes } = record
  clearForward(encoder, resources)
  const pass = encoder.beginComputePass({ label: `${HAIR_STRANDS_PASS_PREFIX}forward visibility` })
  encodeForwardVisibility(
    device,
    pass,
    pipelines,
    resources,
    sourcesOf(gpu, record),
    members.map((member, at) => ({
      drawn: drawn[at]!,
      curves: member.group.curves,
      curveCount: member.group.curveCount,
    })),
    inputs.size,
  )
  encodeHairTiles(
    device,
    pass,
    programs.tiles,
    buffers.tiles,
    imageBlock.buffer,
    record.targets.transmittanceView,
    tileRect,
  )
  encodeHairNodeArgs(device, pass, programs.compact, nodes)
  // The samples are control points, not the pixels of a sorted list: no coverage is updated over them.
  encodeHairMaterial(
    device,
    pass,
    { material: programs.material.material, coverage: undefined },
    gpu.materialBinds,
    nodes,
    drawn,
    buffers.tiles,
    record.targets.nodeIndexView,
  )
  pass.end()
  return true
}

/**
 * The colour raster of an image drawn by the forward raster, once the points are lit (`light` is the grid they were lit on): the segments shaded into the
 * colour texture the composition lays on the image. The colour texture, or none where the raster is not ready.
 */
export function encodeHairForwardColor(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  gpu: HairViewGpu,
  light: GPUTextureView,
): GPUTextureView | undefined {
  const { forward, record } = gpu
  const pipelines = forwardPipelines(device)
  if (!forward || !record || !pipelines) return undefined
  const sources: Sources = { ...sourcesOf(gpu, record), light }
  encodeForwardColor(device, encoder, pipelines, forward as ForwardResources, sources)
  return forward.color
}
