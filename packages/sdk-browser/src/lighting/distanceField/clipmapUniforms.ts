import { splitDouble } from '../../../../math/src/float/splitDouble.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  clipmapResolution,
  minMeshRadius,
  pageTableClipmapResolution,
  GLOBAL_DISTANCE_FIELD_CULL_GRID_FACTOR as CULL_FACTOR,
  GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS as INFLUENCE_VOXELS,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION as PAGE,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS as IN_ATLAS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { ARGS_WORDS, CLIP_BLOCK, CLIP_FLAG_PARENT, CONTROL } from './clipmapBlock.ts'
import type { ClipmapPlan } from './updateRegions.ts'
import type { UpdateBound, Vec3 } from './regionBounds.ts'

/**
 * A CLIPMAP'S NUMBERS FOR THE PASSES, from its plan: its block (`clipmapBlock.ts`), the record the
 * placements are culled against, and the regions to composite again. The block is written in the
 * clipmap's own translated world, its centre at the origin, the way the passes read it.
 */

/** The sizes of a clipmap's grids and of its lists in the buffers, for one setting. */
export function clipmapSizes(settings: GlobalDistanceFieldSettings) {
  const pages = pageTableClipmapResolution(settings)
  const cells = ceilDiv(pages, CULL_FACTOR)
  const pageGrid = pages ** 3
  const cullGrid = cells ** 3
  const perCell = settings.globalDistanceFieldAverageCulledObjectsPerCell
  return {
    pages,
    cells,
    pageGrid,
    cullGrid,
    /** The words of one clipmap's lists of tiles: updated pages, composed pages, culling cells. */
    tiles: 2 * pageGrid + cullGrid,
    /** The words of one clipmap's culling grid: a header of two words a cell, then the objects. */
    cull: 2 * cullGrid + cullGrid * perCell,
  }
}

/** What a block is written from. */
export interface BlockInputs {
  readonly settings: GlobalDistanceFieldSettings
  readonly plan: ClipmapPlan
  /** The clipmap's rank among those updated in this cache pass. */
  readonly rank: number
  readonly maxPages: number
  readonly objectStride: number
  /** The first of the clipmap's regions in the update bounds buffer. */
  readonly boundsBase: number
  /** Whether the composition reads the static clipmap under this one. */
  readonly parent: boolean
}

type BlockField = keyof typeof CLIP_BLOCK.at

/** Writes the three floats of `v` at the field `name` of the block at `at`. */
const put3 = (words: Float32Array, at: number, name: BlockField, v: ArrayLike<number>) => {
  for (let k = 0; k < 3; k++) words[at + CLIP_BLOCK.at[name] + k] = v[k]
}

/** Writes the three integers of `v` at the field `name` of the block at `at`. */
const putU3 = (ints: Uint32Array, at: number, name: BlockField, v: ArrayLike<number>) => {
  for (let k = 0; k < 3; k++) ints[at + CLIP_BLOCK.at[name] + k] = v[k]
}

/** The sizes a clipmap's block is written from. */
interface BlockGeometry {
  /** The clipmap's half-extent. */
  readonly e: number
  readonly size: number
  readonly voxel: number
  readonly half: number
  readonly sizes: ReturnType<typeof clipmapSizes>
}

/** Writes the clipmap's place: its translation, voxel, grids, bounds, lists and flags. */
function writeBlockPlace(
  words: Float32Array,
  ints: Uint32Array,
  at: number,
  inputs: BlockInputs,
  { voxel, half, sizes }: BlockGeometry,
) {
  const { plan, rank } = inputs
  const centre = plan.center.map((c) => -c)
  const split = centre.map(splitDouble)
  const field = CLIP_BLOCK.at
  put3(
    words,
    at,
    'translationHigh',
    split.map((s) => s[0]),
  )
  put3(
    words,
    at,
    'translationLow',
    split.map((s) => s[1]),
  )
  words[at + field.voxelExtent] = half
  words[at + field.influenceRadius] = INFLUENCE_VOXELS * voxel
  words[at + field.influenceRadiusSq] = (INFLUENCE_VOXELS * voxel) ** 2
  putU3(ints, at, 'pageGrid', [sizes.pages, sizes.pages, sizes.pages])
  ints[at + field.offsetZ] = plan.index * sizes.pages
  putU3(ints, at, 'cullGrid', [sizes.cells, sizes.cells, sizes.cells])
  ints[at + field.updateBounds] = plan.updates.length
  ints[at + field.boundsBase] = inputs.boundsBase
  const tiles = rank * sizes.tiles
  putU3(ints, at, 'tiles', [tiles, tiles + sizes.pageGrid, tiles + 2 * sizes.pageGrid])
  const cull = rank * sizes.cull
  ints[at + field.cullHeader] = cull
  ints[at + field.cullArray] = cull + 2 * sizes.cullGrid
  ints[at + field.control] = CONTROL.counters + rank * CONTROL.countersPerClipmap
  ints[at + field.args] = rank * ARGS_WORDS
  ints[at + field.packed] = rank
  ints[at + field.objectStride] = inputs.objectStride
  ints[at + field.maxPages] = inputs.maxPages
  ints[at + field.flags] = inputs.parent ? CLIP_FLAG_PARENT : 0
}

/** Writes the clipmap's scales and biases: from a page, a cell or a voxel to the world. */
function writeBlockScales(
  words: Float32Array,
  at: number,
  plan: ClipmapPlan,
  { e, size, voxel, half, sizes }: BlockGeometry,
) {
  const pageScale = size / sizes.pages
  const cellScale = size / sizes.cells
  const field = CLIP_BLOCK.at
  put3(words, at, 'pageToVoxelScale', [voxel, voxel, voxel])
  put3(words, at, 'pageToVoxelBias', [half - e, half - e, half - e])
  words[at + field.pageWorldRadius] = Math.sqrt(3) * PAGE * half
  put3(words, at, 'pageToPageScale', [pageScale, pageScale, pageScale])
  const pageBias = 0.5 * pageScale - e
  put3(words, at, 'pageToPageBias', [pageBias, pageBias, pageBias])
  words.set([...plan.scroll.map((s) => s / size + 0.5), 1 / size], at + field.uvAddMul)
  put3(words, at, 'pageTileExtent', [half * IN_ATLAS, half * IN_ATLAS, half * IN_ATLAS])
  put3(words, at, 'pageWorldExtent', [half * PAGE, half * PAGE, half * PAGE])
  put3(words, at, 'composeTileExtent', [half * 4, half * 4, half * 4])
  const cullExtent = half * IN_ATLAS * CULL_FACTOR
  put3(words, at, 'cullTileExtent', [cullExtent, cullExtent, cullExtent])
  put3(words, at, 'cullToCentreScale', [cellScale, cellScale, cellScale])
  const cellBias = 0.5 * cellScale - e
  put3(words, at, 'cullToCentreBias', [cellBias, cellBias, cellBias])
}

/** Writes `inputs`' block into `words` (floats) and `ints` (the same memory as words) at `at`. */
export function writeClipmapBlock(
  words: Float32Array,
  ints: Uint32Array,
  at: number,
  inputs: BlockInputs,
) {
  const { settings, plan } = inputs
  const e = plan.extent
  const size = 2 * e
  const voxel = size / clipmapResolution(settings)
  const geometry: BlockGeometry = {
    e,
    size,
    voxel,
    half: 0.5 * voxel,
    sizes: clipmapSizes(settings),
  }
  writeBlockPlace(words, ints, at, inputs, geometry)
  writeBlockScales(words, at, plan, geometry)
}

/** Writes the culling record of `plan` for a view at `origin`: the clipmap's centre relative to the
 *  camera, the smallest mesh it holds, its half-extent, its range squared, its index and whether
 *  its meshes' streaming is watched. */
export function writePackedClipmap(
  words: Float32Array,
  ints: Uint32Array,
  at: number,
  settings: GlobalDistanceFieldSettings,
  plan: ClipmapPlan,
  origin: Vec3,
  watched: boolean,
) {
  const voxel = (2 * plan.extent) / clipmapResolution(settings)
  const influence = INFLUENCE_VOXELS * voxel
  words.set(
    plan.center.map((c, k) => c - origin[k]),
    at,
  )
  words[at + 3] = minMeshRadius(settings, voxel)
  words.set([plan.extent, plan.extent, plan.extent, influence * influence], at + 4)
  ints[at + 8] = plan.index
  ints[at + 9] = watched ? 1 : 0
}

/** Writes the regions of a clipmap into `words`: two `vec4` each, the centre relative to the clipmap's
 *  centre with a 1 for a region the influence range grows, then the half-extent. */
export function writeUpdateBounds(words: Float32Array, plan: ClipmapPlan) {
  plan.updates.forEach((bound: UpdateBound, k) => {
    for (let a = 0; a < 3; a++) {
      words[k * 8 + a] = bound.center[a] - plan.center[a]
      words[k * 8 + 4 + a] = bound.extent[a]
    }
    words[k * 8 + 3] = bound.expand ? 1 : 0
    words[k * 8 + 7] = 0
  })
}
