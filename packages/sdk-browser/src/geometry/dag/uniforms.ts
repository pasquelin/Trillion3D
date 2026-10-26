import type { PackedDag } from './types.ts'
import {
  OUT_COUNT,
  OUT_FLAGS,
  OUT_FRUSTUM_REJECTED,
  OUT_LOD_LEVEL,
  OUT_OCCLUDED,
  OUT_POST_HIDDEN,
  OUT_SELECTED_TRIANGLES,
  OUT_TRANSPARENT_TRIANGLES,
} from './layout.ts'
import {
  PEAK_CANDIDATES,
  PEAK_NODES,
  PEAK_VISIBLE,
  SELECTION_HEADER_WORDS,
  readSortedList,
} from './readoutWords.ts'
import type { SelectionResult, SelectionUniforms } from '../../gpu/core/selection.ts'
import { twoPassOf } from './shader/occlusionWgsl.ts'
import { CULL_NO_DRAW_DISTANCES } from './shader/viewsWgsl.ts'
import { viewWord } from './viewLayout.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import { dagFlagShape, type FlagShape } from './flagSections.ts'
import type { ListPeaks } from './lists/listFeedback.ts'
import { INITIAL_VISIBLE } from './visible/layout.ts'

/** Where a cut's tables lie for its kernels: the open counts placements hold in `out` — the first
 *  word in `out.pages`, the slots less one (`heldOpen.ts`) —, then the shape its `flags` is laid
 *  out for (`flagSections.ts`), the packing's at the lists' default caps when absent, and the
 *  records its list of visible clusters holds (`visible/layout.ts`). */
export type CutTablesAt = {
  base: number
  mask: number
  shape?: FlagShape
  filter?: number
  visibleCap?: number
}

/**
 * Arrays of a readback slot, reused from one read to the next: reallocating them on every
 * readback threw tens of thousands of elements at the garbage collector, to rewrite exactly
 * the same ranks.
 */
export type DagOutputScratch = {
  result: SelectionResult
  drawable: number[]
  peaks: ListPeaks
}
export const createDagOutputScratch = (): DagOutputScratch => ({
  result: {
    requests: { pages: [], counts: [], priorities: [] },
    pageIds: [],
    frustumRejected: 0,
    lodLevel: 0,
    occluded: 0,
    postHidden: 0,
    selectedTriangles: 0,
    transparentTriangles: 0,
  },
  drawable: [],
  peaks: { nodes: 0, candidates: 0, visible: 0 },
})

/** The unsigned word view of each block written, made once: a cut writes its block every frame. */
const wordsOf = new WeakMap<Float32Array, Uint32Array>()

/**
 * One view's block of the uniform array (`shader/viewsWgsl.ts`). Every word is written through
 * `viewWord`, the name the kernels read it by, so a field added to `viewLayout.ts` moves the host
 * and the shader together. The camera runs one view on buffers sized for one, whose queues hold
 * every node. `listCap` is the ranks its readout holds (`lists/listCap.ts`). `at`, where the
 * open counts placements hold lie in `out` (`lists/listCap.ts`, `heldOpenAt`) — none by default —,
 * and the shape the cut's `flags` is laid out for (`queueGrowth.ts`, `cutTablesAt`), the
 * packing's at the lists' default caps by default, and the word of `work` the filter's bits lie at
 * (`filter`, `viewFilterRegion.ts`): a view that has a filter names it in its block, the others 0.
 */
export function writeDagUniforms(
  target: Float32Array,
  packed: PackedDag,
  uniforms: SelectionUniforms,
  listCap: number,
  at: CutTablesAt = { base: 0, mask: 0 },
) {
  const W = viewWord
  target.fill(0)
  target.set(uniforms.planes, W('planes'))
  target.set(uniforms.view, W('view'))
  target[W('pixelScale')] = uniforms.pixelScale[0]
  target[W('pixelScale') + 1] = uniforms.pixelScale[1]
  target[W('pixelError')] = uniforms.pixelError
  target[W('near')] = uniforms.near
  const ints = wordsView(target)
  ints[W('clusterCount')] = packed.pageCount
  ints[W('nodeCount')] = packed.nodeCount
  ints[W('worldCount')] = packed.worldCount
  if (uniforms.cameraWorld) writeEye(target, ints, uniforms.cameraWorld)
  writeOcclusion(target, ints, uniforms)
  // The view's clip plane in the render frame (`shader/clipPlaneWgsl.ts`), all zero for none, and
  // its filter's bits (`shader/viewFilterWgsl.ts`), 0 unless the view has them.
  target.set(uniforms.clipPlane, W('clipPlane'))
  ints[W('filterBase')] = uniforms.filter ? (at.filter ?? 0) : 0
  // A packing no placement of which names a distance tests none: the cut reads no distance word
  // (`shader/drawDistanceWgsl.ts`).
  if (!packed.drawDistance) ints[W('cullOff')] |= CULL_NO_DRAW_DISTANCES
  // Sample cap the kernel reads to bound its two halves and to say, when it happens, that it
  // truncated (`lists/listCap.ts`).
  ints[W('listCap')] = listCap
  // The projection's clip-w weight: 1 perspective, 0 orthographic (`screenErrorBound.ts`).
  target[W('perspective')] = uniforms.perspective ?? 1
  writeListShape(ints, packed, at)
  writeRasterJudgement(target, ints, uniforms.raster)
  writePlacementWords(ints, packed)
}

/** The unsigned word view of `target`, made once. */
function wordsView(target: Float32Array) {
  let ints = wordsOf.get(target)
  if (!ints) {
    ints = new Uint32Array(target.buffer, target.byteOffset, target.length)
    wordsOf.set(target, ints)
  }
  return ints
}

/** The camera's world position, and the eye exact. */
function writeEye(
  target: Float32Array,
  ints: Uint32Array,
  cw: NonNullable<SelectionUniforms['cameraWorld']>,
) {
  const W = viewWord
  target[W('cameraWorld')] = cw[0]
  target[W('cameraWorld') + 1] = cw[1]
  target[W('cameraWorld') + 2] = cw[2]
  // The eye exact, which every translation the cut reads is taken off (`worldPoseWgsl.ts`).
  packDoubles(ints, W('eye'), cw, 0, 3)
}

/** The lists as the flags lay them out, the visible cap and where the open counts lie. */
function writeListShape(ints: Uint32Array, packed: PackedDag, at: CutTablesAt) {
  const W = viewWord
  // The lists as the flags lay them out, and the nodes a pass opens at most (`flagSections.ts`):
  // the descent array two words an entry, the node then its placement (`shader/listsWgsl.ts`).
  const shape = at.shape ?? dagFlagShape(packed)
  ints[W('queueCap')] = shape.queueWords
  ints[W('candCap')] = shape.candCap
  ints[W('visCap')] = at.visibleCap ?? Math.min(packed.pageCount, INITIAL_VISIBLE)
  ints[W('nodeBudget')] = shape.nodeBudget
  // The open counts placements hold of their own (`heldOpen.ts`): where in `out.pages`, how many.
  ints[W('heldBase')] = at.base
  ints[W('heldMask')] = at.mask
}

/** The placement tree's words, and the placements' links to the world's cells. */
function writePlacementWords(ints: Uint32Array, packed: PackedDag) {
  const W = viewWord
  // The placement tree (`placement/placementTree.ts`): its top level's nodes, which open the descent, the
  // queue entry of its first node and the members drawn whatever the view — the world DAG's
  // placements among them (`tree/treeTable.ts`); no top node, no tree.
  const tree = packed.placementTree,
    world = packed.world
  ints[W('treeTop')] = tree?.levels[0].count ?? 0
  ints[W('cellBase')] = tree?.cellBase ?? 0
  ints[W('alwaysCount')] = tree?.always.set.count ?? 0
  // The placements' links to the world's cells (`worlds/worldLinks.ts`): none, no gate.
  ints[W('worldLinks')] = world?.linkBase ?? 0
}

/** What the cluster cull judges the rasters by (`shader/visibleWgsl.ts`), written into the block;
 *  without it the software raster is off, nothing is tessellated and no depth bucket is made. */
function writeRasterJudgement(
  target: Float32Array,
  ints: Uint32Array,
  raster: SelectionUniforms['raster'],
) {
  const W = viewWord
  ints[W('softwareRaster')] = raster?.software ? 1 : 0
  target[W('hardwareEdge')] = raster?.hardwareEdge ?? 0
  ints[W('tessellation')] = raster?.tessellation ? 1 : 0
  ints[W('depthBuckets')] = raster?.buckets ? 1 : 0
  target[W('bucketMinZ')] = raster?.buckets?.minZ ?? 1
  target[W('bucketMaxZ')] = raster?.buckets?.maxZ ?? 1
}

/** The projection's words of the block (`shader/occlusionWgsl.ts`): the render matrix, its depth
 *  map and the view's size, which every box's pixel centres are found with; the culls the host
 *  turned off and the scale of the draw distances (`shader/viewsWgsl.ts`,
 *  `shader/drawDistanceWgsl.ts`); what the occlusion runs, and, when it runs two passes, the
 *  same three at the image before. */
function writeOcclusion(target: Float32Array, ints: Uint32Array, uniforms: SelectionUniforms) {
  const W = viewWord,
    occlusion = uniforms.occlusion ?? 0
  target.set(uniforms.viewProj, W('viewProj'))
  target.set(uniforms.depthMap, W('depthMap'))
  ints.set(uniforms.viewSize, W('viewSize'))
  ints[W('cullOff')] = uniforms.cullOff ?? 0
  target[W('viewDistanceScale')] = uniforms.viewDistanceScale ?? 1
  target[W('primitiveDistanceScale')] = uniforms.primitiveDistanceScale ?? 1
  ints[W('occlusion')] = occlusion
  if (!twoPassOf(uniforms)) return
  target.set(uniforms.prevViewProj!, W('prevViewProj'))
  target.set(uniforms.prevDepthMap!, W('prevDepthMap'))
  ints.set(uniforms.prevSize!, W('prevSize'))
}

/** The requests of a readback into `result`: each rank is a REQUEST — a leaf's first page, a whole
 *  word, in the order the GPU's threads asked them, its page count and its priority at the same
 *  rank of their lists (`request/request.ts`): the host ranks them. The pages they name follow,
 *  request after request, in `pageIds`.
 *
 *  Arrays written rank after rank, then cut to their length, and never sized ahead: an array whose
 *  length is set before its ranks are written holds holes from then on, and each of the reads that
 *  follow — the cut's difference, its records, its packed ranks, several a frame on a hundred
 *  thousand ranks — pays the hole check, near six times a packed read (#831). A frame reuses the
 *  arrays it grew; a typed-array iterator is never unrolled. */
function readRequests(
  ints: Uint32Array,
  head: number,
  held: number,
  at: { priorities: number; counts: number },
  result: SelectionResult,
) {
  const { pageIds, requests } = result
  const count = Math.min(
    ints[OUT_COUNT] ?? 0,
    held,
    Math.max(0, ints.length - at.priorities),
    Math.max(0, ints.length - at.counts),
  )
  let pages = 0
  for (let i = 0; i < count; i++) {
    const first = ints[head + i],
      named = ints[at.counts + i]
    requests.pages[i] = first
    requests.counts[i] = named
    requests.priorities[i] = ints[at.priorities + i]
    for (let k = 0; k < named; k++) pageIds[pages++] = first + k
  }
  requests.pages.length = requests.counts.length = requests.priorities.length = count
  pageIds.length = pages
}

/** The cut's counters of a readback into `result`: what the GPU holds describes the cut, not the
 *  list that reports it, so a truncated sample still returns them correctly
 *  (`shader/totalsWgsl.ts`). */
function readTotals(ints: Uint32Array, result: SelectionResult) {
  result.frustumRejected = ints[OUT_FRUSTUM_REJECTED] ?? 0
  result.lodLevel = ints[OUT_LOD_LEVEL] ?? 0
  result.occluded = ints[OUT_OCCLUDED] ?? 0
  result.postHidden = ints[OUT_POST_HIDDEN] ?? 0
  result.selectedTriangles = ints[OUT_SELECTED_TRIANGLES] ?? 0
  result.transparentTriangles = ints[OUT_TRANSPARENT_TRIANGLES] ?? 0
  // Bit 1: the cut did not fit under the sample cap. This is not a GPU fault — the kernels ran,
  // the frame mask is correct — but the reported LIST is truncated, and nothing that lives off
  // it must take it for the whole cut.
  result.truncated = ((ints[OUT_FLAGS] ?? 0) & 1) !== 0
}

/** `at`: where the readback's lists lie in it — the drawn list's header (`drawn`, 0 when there is
 *  none), the requests' priorities (`priorities`) and their page counts (`counts`), in words. */
export function parseDagOutput(
  bytes: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
  at: { drawn: number; priorities: number; counts: number },
  scratch: DagOutputScratch = createDagOutputScratch(),
): SelectionResult | null {
  const ints = new Uint32Array(bytes, byteOffset, Math.floor(byteLength / 4))
  const head = SELECTION_HEADER_WORDS,
    held = Math.max(0, (at.drawn || ints.length) - head)
  const { result, drawable, peaks } = scratch
  readRequests(ints, head, held, at, result)
  readTotals(ints, result)
  result.drawablePageIds = undefined
  result.peaks = undefined
  if (!at.drawn) return result
  // The drawable list arrives in the order the GPU's threads wrote it: the CPU sorts the ranks the
  // GPU kept, never a flag a DAG page.
  result.drawablePageIds = readSortedList(ints, at.drawn, drawable, held)
  // What the cut asked of its lists, in the drawn list's header (`shader/finishWgsl.ts`): what
  // passed a cap was dropped, and the rest drawn.
  peaks.nodes = ints[at.drawn + PEAK_NODES] ?? 0
  peaks.candidates = ints[at.drawn + PEAK_CANDIDATES] ?? 0
  peaks.visible = ints[at.drawn + PEAK_VISIBLE] ?? 0
  result.peaks = peaks
  return result
}
