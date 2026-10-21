import type { PackedDag } from '../../../packages/sdk-browser/src/geometry/dag/types.ts'
import { dagBindingOf } from '../../../packages/sdk-browser/src/geometry/dag/shader/bindings.fixture.ts'
import { viewWord } from '../../../packages/sdk-browser/src/geometry/dag/viewLayout.ts'
import { CLUSTER_WORDS } from '../../../packages/sdk-browser/src/geometry/dag/layout.ts'
import { floats, words } from './fakeBuffers.ts'
import { recordWord, viewTexture, worldsAtEye } from './fakeWorldPose.ts'
import {
  FRAME_TABLE,
  MARK_WORD,
  PAGE_BASE_WORD,
  PAGE_COUNT_WORD,
  RECORD_SHIFT_WORD,
  ROOT_WORD,
} from '../../../packages/sdk-browser/src/geometry/dag/frameTable.ts'
import { indexOfRanks } from '../../../packages/sdk-browser/src/geometry/selection/placements.fixture.ts'

type Bound = Map<number, { data: Uint8Array }>

/** The binding of each table of the selection kernel's group 0, read once off the production
 *  entries (`dagBindingOf`). */
export const DAG_SLOT = dagBindingOf()

/** A bound record table: the view at its binding (`DAG_SLOT.worlds`, `.frames`). */
type View = Parameters<typeof viewTexture>[0]

/** Word `k` of placement `w`'s frame words in the bound frame table `frames`, as the kernels read
 *  it (`frameTable.ts`). */
export const frameWord = (frames: View, w: number, k: number) =>
  recordWord(frames, FRAME_TABLE, 'Row', w, k)

/** The DAG selection uniform block as the shader reads it: the camera. */
export function readDagUniforms(data: Uint8Array) {
  const f32 = floats(data),
    u32 = words(data)
  const at = viewWord,
    camera = at('cameraWorld'),
    scale = at('pixelScale')
  return {
    uniforms: {
      planes: f32.slice(at('planes'), at('planes') + 24),
      view: f32.slice(at('view'), at('view') + 16),
      pixelScale: [f32[scale], f32[scale + 1]] as [number, number],
      pixelError: f32[at('pixelError')],
      near: f32[at('near')],
      cameraWorld: [f32[camera], f32[camera + 1], f32[camera + 2]] as [number, number, number],
      viewProj: f32.slice(at('viewProj'), at('viewProj') + 16),
      depthMap: [f32[at('depthMap')], f32[at('depthMap') + 1]] as [number, number],
      viewSize: [u32[at('viewSize')], u32[at('viewSize') + 1]] as [number, number],
    },
  }
}

/** The list cap the kernels read, from the camera's uniform block (`listCap.ts`). */
export const boundListCap = (byBinding: Bound) =>
  words(byBinding.get(DAG_SLOT.views)!.data)[viewWord('listCap')]

/**
 * The DAG a cut's bound buffers hold, for a device no test handed one (`fakeDevice({ packed })`):
 * the tables as the host uploaded them, the counts as the camera's uniform block carries them, and
 * each primitive's words as its frame row holds them (`primitiveFrameWords`). What the kernels'
 * CPU doubles read of a packing, and nothing more: the GPU cut is the engine's one cut (#1483), so
 * every session on the double runs it.
 */
export function packedFromBindings(
  byBinding: Bound,
  worlds: View,
  frames: View,
): PackedDag & { frameStretch: Float32Array } {
  const views = words(byBinding.get(DAG_SLOT.views)!.data)
  const pageCount = views[viewWord('clusterCount')],
    nodeCount = views[viewWord('nodeCount')],
    worldCount = views[viewWord('worldCount')]
  /** Word `at` of each primitive's frame row. */
  const intsAt = (at: number) =>
    Uint32Array.from({ length: worldCount }, (_, w) => frameWord(frames, w, at))
  const rootNodes = intsAt(ROOT_WORD)
  // Each page's placement, from each placement's first page and page count (`worlds.ts`): the
  // kernels read it from the entries that carry it, the double indexes the placements.
  const ranks: number[] = [],
    firsts = intsAt(PAGE_BASE_WORD),
    counts = intsAt(PAGE_COUNT_WORD)
  for (let w = 0; w < worldCount; w++)
    for (let page = firsts[w]; page < firsts[w] + counts[w]; page++) ranks[page] = w
  const pageIndex = indexOfRanks(ranks, worldCount)
  const clusters = floats(byBinding.get(DAG_SLOT.clusters)!.data)
  return {
    kind: 'dag',
    clusters,
    nodes: floats(byBinding.get(DAG_SLOT.nodes)!.data),
    coldWords: floats(byBinding.get(DAG_SLOT.cold)!.data),
    worlds: worldsAtEye(viewTexture(worlds), byBinding.get(DAG_SLOT.views)!.data, worldCount * 16),
    // The stretch the cut reads, its own field (`frameTable.ts`).
    frameStretch: new Float32Array(
      Uint32Array.from({ length: worldCount }, (_, w) =>
        recordWord(frames, FRAME_TABLE, 'Stretch', w),
      ).buffer,
    ),
    rootNodes,
    rootBases: rootNodes.slice(),
    recordShift: intsAt(RECORD_SHIFT_WORD),
    mark: intsAt(MARK_WORD),
    levelSizes: new Uint32Array(0),
    nodeCount,
    primitiveNodeCount: nodeCount,
    // The nodes one pass opens at most, as the block holds them (`flagSections.ts`).
    entryCount: views[viewWord('nodeBudget')],
    worldCount,
    pageCount,
    // The records the hot table holds room for (`layout.ts`): the uniform block names none.
    recordCount: Math.floor(clusters.length / CLUSTER_WORDS),
    pageIndex,
    rootCount: worldCount,
    pageUrlOf: () => undefined,
    cutLinks: [],
    // The bindings hold the worlds, not the host's placements.
    worldSources: [],
  }
}
