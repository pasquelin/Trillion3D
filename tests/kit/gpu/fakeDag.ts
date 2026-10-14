import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'
import { dagBindingOf } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.fixture.ts'
import { viewWord } from '../../../packages/sdk-browser/src/gpu/dag/viewLayout.ts'
import { floats, words } from './fakeBuffers.ts'
import { recordWord, viewTexture, worldsAtEye } from './fakeWorldPose.ts'
import {
  FRAME_TABLE,
  MARK_WORD,
  PAGE_BASE_WORD,
  PAGE_COUNT_WORD,
  RECORD_SHIFT_WORD,
  ROOT_WORD,
} from '../../../packages/sdk-browser/src/gpu/dag/frameTable.ts'
import { indexOfRanks } from '../../../packages/sdk-browser/src/page/selection/placements.fixture.ts'

type Bound = Map<number, { data: Uint8Array }>
/** A bound record table: the view at its binding (`dagBindingOf().worlds`, `.frames`). */
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
      cameraStretch: f32[at('cameraStretch')],
      admitByLevel: !!u32[at('admitByLevel')],
    },
  }
}

/** The list cap the kernels read, from the camera's uniform block (`listCap.ts`). */
export const boundListCap = (byBinding: Bound) =>
  words(byBinding.get(dagBindingOf().views)!.data)[viewWord('listCap')]

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
  const views = words(byBinding.get(dagBindingOf().views)!.data)
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
  return {
    kind: 'dag',
    clusters: floats(byBinding.get(dagBindingOf().clusters)!.data),
    nodes: floats(byBinding.get(dagBindingOf().nodes)!.data),
    pageCones: floats(byBinding.get(dagBindingOf().cold)!.data),
    worlds: worldsAtEye(
      viewTexture(worlds),
      byBinding.get(dagBindingOf().views)!.data,
      worldCount * 16,
    ),
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
    // Two words an entry in each queue (`levelWgsl.ts`).
    entryCount: views[viewWord('queueCap')] / 2,
    queueEntries: views[viewWord('queueCap')] / 2,
    worldCount,
    pageCount,
    recordCount: views[viewWord('recordCount')],
    keyCount: views[viewWord('keyCount')],
    groupCount: views[viewWord('groupCount')],
    groupEdges: views[viewWord('groupEdges')],
    candCount: views[viewWord('candCap')],
    pageIndex,
    rootCount: worldCount,
    pageUrlOf: () => undefined,
    cutLinks: [],
    // The bindings hold the worlds, not the host's placements.
    worldSources: [],
  }
}
