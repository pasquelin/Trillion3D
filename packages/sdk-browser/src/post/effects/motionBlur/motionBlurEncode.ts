import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { MOTION_BLUR_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { heldColour } from '../../../gpu/core/heldAttachment.ts'
import { resetListIn } from '../../../gpu/dispatch/list.ts'
import { SCATTER_QUADS, SCATTER_VERTICES } from './dilateWgsl.ts'
import { FILTER_TILE, FLATTEN_TILE, filterTiles, flattenTiles } from './motionBlurLayout.ts'
import type { MotionBlurPrograms } from './motionBlurPrograms.ts'
import type { Kit } from './motionBlurVariants.ts'
import type { MotionBlurTargets } from './motionBlurTargets.ts'

/** The groups the passes of one blur are bound with (`MotionBlurSet`). */
export type MotionBlurGroups = {
  flatten: GPUBindGroup
  /** The spread by reading the neighbours. */
  gather: GPUBindGroup
  /** With two directions where the spread is drawn: the pass that gathers the second largest
   *  motions beside the drawn ranges; none with one. */
  gatherDrawn: GPUBindGroup | undefined
  scatter: GPUBindGroup
  classify: GPUBindGroup
  /** The filter of the image, a group a class, writing the blurred image or, in two passes, the
   *  one between. */
  filter: readonly GPUBindGroup[]
  /** The second filter pass of a separable blur, reading the image between; none otherwise. */
  second: readonly GPUBindGroup[] | undefined
}

/** What one blur encodes from: the programs and targets, the pipelines of its compute passes (`kit`,
 *  the blur's directions and spread), its groups and its lists of filter tiles, the image's size, the
 *  grid the motion was measured on, whether the spread is drawn and whether the motion is flattened
 *  already. */
type MotionBlurDraw = {
  programs: MotionBlurPrograms
  kit: Kit
  targets: MotionBlurTargets
  groups: MotionBlurGroups
  lists: readonly GPUBuffer[]
  image: readonly number[]
  grid: readonly number[]
  drawn: boolean
  /** Whether the temporal pass's nearest velocity flattened the motion already (`FusedFlatten`). */
  flattened: boolean
  /** The translucency drawn after the blur, the filter's second group: the layers of the image, or
   *  none (`noLayers`) where the pass lays none. */
  layers: GPUBindGroup
}

/** The motion flattened to its tiles, one dispatch. */
function flatten(pass: GPUComputePassEncoder, { kit, groups, grid }: MotionBlurDraw) {
  pass.setPipeline(kit.flatten)
  pass.setBindGroup(0, groups.flatten)
  pass.dispatchWorkgroups(ceilDiv(grid[0], FLATTEN_TILE), ceilDiv(grid[1], FLATTEN_TILE))
}

/** The tiles' largest motions spread over the tiles they cross by reading the neighbours — or,
 *  with two directions where they were drawn, the second largest ones alone, from `group`. */
function gather(pass: GPUComputePassEncoder, { kit, grid }: MotionBlurDraw, group: GPUBindGroup) {
  pass.setPipeline(kit.gather)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(
    ceilDiv(flattenTiles(grid[0]), FLATTEN_TILE),
    ceilDiv(flattenTiles(grid[1]), FLATTEN_TILE),
  )
}

const scatterTarget = heldColour({ loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] })
const scatterDepth = {
  depthLoadOp: 'clear',
  depthStoreOp: 'discard',
  depthClearValue: 1,
} as GPURenderPassDepthStencilAttachment
const SCATTER: GPURenderPassDescriptor = {
  label: MOTION_BLUR_PASS,
  colorAttachments: [scatterTarget],
  depthStencilAttachment: scatterDepth,
}

/** The same spread by drawing: two draws of a quad a tile in one pass over the tile image, the
 *  first keeping the shorter smallest motion, the second the longer largest. */
function scatter(encoder: GPUCommandEncoder, { programs, targets, groups, grid }: MotionBlurDraw) {
  const { tilesB, depth } = targets.held
  const across = flattenTiles(grid[0]),
    down = flattenTiles(grid[1])
  scatterTarget.view = tilesB.view
  scatterDepth.view = depth.view
  const pass = encoder.beginRenderPass(SCATTER)
  pass.setViewport(0, 0, across, down, 0, 1)
  pass.setScissorRect(0, 0, across, down)
  pass.setBindGroup(0, groups.scatter)
  const instances = ceilDiv(across * down, SCATTER_QUADS)
  for (const pipeline of [programs.scatterSmallest, programs.scatterLargest]) {
    pass.setPipeline(pipeline)
    pass.draw(SCATTER_VERTICES, instances)
  }
  pass.end()
}

/** The filter tiles classified into the lists of their classes. */
function classify(pass: GPUComputePassEncoder, draw: MotionBlurDraw) {
  const { kit, groups, image } = draw
  pass.setPipeline(kit.classify)
  pass.setBindGroup(0, groups.classify)
  pass.dispatchWorkgroups(
    ceilDiv(filterTiles(image[0]), FILTER_TILE),
    ceilDiv(filterTiles(image[1]), FILTER_TILE),
  )
}

/** The image filtered, a dispatch for each class of tile over its list, through `groups`. */
function filter(
  pass: GPUComputePassEncoder,
  { kit, lists, layers }: MotionBlurDraw,
  groups: readonly GPUBindGroup[],
) {
  pass.setBindGroup(1, layers)
  for (let at = 0; at < kit.filters.length; at++) {
    pass.setPipeline(kit.filters[at])
    pass.setBindGroup(0, groups[at])
    pass.dispatchWorkgroupsIndirect(lists[at], 0)
  }
}

const PASS: GPUComputePassDescriptor = { label: MOTION_BLUR_PASS }

/**
 * Encodes the blur of one image, its lists emptied first: the motion flattened to its tiles — left
 * to the temporal pass's nearest velocity where it did (`flattened`), which wrote it already —, those
 * spread over the tiles they cross — by reading the neighbours in the same compute pass, or by
 * drawing between two —, the filter tiles classified into the lists of their classes, the filter
 * of each class over its list, and, for a separable blur, a second pass of it reading the first's
 * image. Returns the passes encoded.
 */
export function encodeMotionBlur(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  draw: MotionBlurDraw,
) {
  for (const list of draw.lists) resetListIn(device, encoder, list)
  let pass = encoder.beginComputePass(PASS)
  if (!draw.flattened) flatten(pass, draw)
  let passes = 1
  if (draw.drawn) {
    pass.end()
    scatter(encoder, draw)
    pass = encoder.beginComputePass(PASS)
    passes += 2
    if (draw.groups.gatherDrawn) gather(pass, draw, draw.groups.gatherDrawn)
  } else gather(pass, draw, draw.groups.gather)
  classify(pass, draw)
  filter(pass, draw, draw.groups.filter)
  if (draw.groups.second) filter(pass, draw, draw.groups.second)
  pass.end()
  return passes
}
