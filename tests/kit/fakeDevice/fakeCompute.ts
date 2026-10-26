import { bitWords } from '../../../packages/math/src/scalar/integers.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/geometry/dag/types.ts'
import { drawMask } from './globals.ts'
import { TRANSPARENT_STAGES } from './fakeComputeBlend.ts'
import { ROW_STAGES } from './fakeComputeRows.ts'
import { VISIBILITY_STAGES } from './fakeVisibility.ts'
import { boundResource, boundWords, words, type BoundBuffer } from './fakeBuffers.ts'
import { childBase } from '../../../packages/sdk-browser/src/geometry/dag/layout.ts'
import { levelsDispatched } from '../../../packages/sdk-browser/src/geometry/dag/encode.ts'
import { viewWord } from '../../../packages/sdk-browser/src/geometry/dag/viewLayout.ts'
import { poolSortReplayOf } from './fakePoolSorts.ts'
import {
  DAG_SLOT,
  boundListCap,
  frameWord,
  packedFromBindings,
  readDagUniforms,
} from './fakeDag.ts'
import { boundData, viewTexture, worldsAtEye } from './fakeWorldPose.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/geometry/dag/oracle/oracle.fixture.ts'
import {
  dagRecords,
  flagsOf,
  worldOf,
} from '../../../packages/sdk-browser/src/geometry/dag/records.fixture.ts'
import { CLUSTER_TRANSPARENT } from '../../../packages/sdk-browser/src/geometry/dag/clusterFlags.ts'
import { VISIBLE_RECORD_WORDS } from '../../../packages/sdk-browser/src/geometry/dag/visible/layout.ts'
import {
  NO_SPLIT,
  VIS_ASKED,
  VIS_HW,
  VIS_TAG_BLENDED,
  VIS_HW_SPLIT,
  VIS_SW,
  VIS_SW_SPLIT,
  VISIBLE_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/geometry/dag/visible/layout.fixture.ts'
import {
  residentFlags,
  writeTriangleTotals,
} from '../../../packages/sdk-browser/src/geometry/dag/layout.fixture.ts'
import {
  countWord,
  listWords,
  PEAK_CANDIDATES,
  PEAK_NODES,
  PEAK_VISIBLE,
  priorityWord,
  SELECTION_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/geometry/dag/readoutWords.ts'
import { setBit } from '../../../packages/math/src/scalar/bits.ts'
import { ROOT_WORD } from '../../../packages/sdk-browser/src/geometry/dag/frameTable.ts'
import { residentGeometryPage } from '../../../packages/sdk-browser/src/geometry/codec/geometryPage.ts'
import {
  PAGE_JOB_WORDS,
  PAGE_JOBS_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/geometry/pages/install/transcodeWgsl.ts'
import { namedRanks } from '../../../packages/sdk-browser/src/geometry/pages/install/namedRanks.ts'

/** The camera cut's kernel the double replays, on the selection's bind group: the cluster cull,
 *  which judges every cluster and writes the list of visible clusters, the readout and the
 *  blended clusters' mask. The cut's ending (`dagFinish`, `dagDrawn`) is replayed with it: the
 *  double's cut is whole. And the pool sorts' last dispatch, on their own group. */
const DAG_STAGES = new Set(['dagWanted', 'poolScatter'])

export type ComputeBind = {
  /** A buffer's binding, or a view's — the worlds' table (`viewTexture`). */
  entries: BoundBuffer[]
}

/** The install passes (`PAGE_TRANSCODE_WGSL`, `PAGE_LINK_WGSL`) replayed by their CPU twin
 *  (`residentGeometryPage`), on the first pass's dispatch: each job's page on disk, in the staging
 *  buffer, becomes the resident page written into the pool at the word the job gives — left
 *  unwritten but for its zeroed version word when it would pass the room the job allows, as on the
 *  device — in the order the pages were staged, which every page a page names vertices of
 *  precedes: the clusters it names are found in the pool as the second pass finds them, where the
 *  job's streaming page and the starts of its dependencies say. */
function simulatePageInstall(bind: ComputeBind, groups: number) {
  const jobs = boundWords(bind.entries, 1)
  const staging = boundResource(bind.entries, 0).buffer.data
  const pool = boundResource(bind.entries, 2).buffer.data
  const starts = boundWords(bind.entries, 3)
  const staged = Array.from({ length: groups }, (_, j) => {
    const at = PAGE_JOBS_HEADER_WORDS + j * PAGE_JOB_WORDS
    return jobs.subarray(at, at + PAGE_JOB_WORDS)
  }).sort((a, b) => a[0] - b[0])
  for (const [src, dst, room, length, unit, dependsAt, dependsOn] of staged) {
    const page = staging.subarray(src * 4, (src + length) * 4)
    const units = [unit, ...starts.subarray(dependsAt, dependsAt + dependsOn)]
    // The pool goes into the module's memory whole with a page that names vertices: only such a page.
    const references = namedRanks(page) ? { pool, units } : undefined
    const resident = residentGeometryPage(page.slice(), undefined, references)
    if (resident.byteLength <= room * 4) pool.set(resident, dst * 4)
    else if (room > 1) pool.fill(0, dst * 4 + 4, dst * 4 + 8)
  }
}

/**
 * The levels the double's descent reads: those the cut dispatches (`levelsDispatched`), so that a
 * packing which counts fewer levels than its hierarchies hold loses the work past them, as it does on
 * the device. A DAG read back from the bindings knows no level count (`packedFromBindings`): none,
 * and the descent reads all of its levels.
 */
export function descentLevels(dag: PackedDag) {
  return dag.levelSizes.length
    ? levelsDispatched({ packed: dag, levelSizes: dag.levelSizes })
    : undefined
}

export function simulateComputeDispatch(
  computePipeline:
    | {
        entryPoint: string
        constants?: Record<string, number>
        module?: { code?: string; label?: string }
      }
    | undefined,
  computeBind: ComputeBind | undefined,
  packed?: PackedDag,
  offsets?: readonly number[],
  groups?: number,
  rows?: number,
) {
  if (computePipeline?.entryPoint === 'transcode' && computeBind?.entries)
    return simulatePageInstall(computeBind, groups ?? 0)
  // The second pass is done by the replay of the first: every page is complete.
  if (computePipeline?.entryPoint === 'link') return
  const transparent = TRANSPARENT_STAGES[computePipeline?.entryPoint ?? '']
  if (transparent && computeBind) return transparent(computeBind, offsets, groups, rows)
  const rowStage = ROW_STAGES[computePipeline?.entryPoint ?? '']
  if (rowStage && computeBind?.entries) return rowStage(computeBind)
  const visibilityStage = VISIBILITY_STAGES[computePipeline?.entryPoint ?? '']
  if (visibilityStage && computeBind?.entries)
    return visibilityStage(computeBind, computePipeline?.constants ?? {})
  const stage = computePipeline?.entryPoint
  // A group a test wrote by hand, without entries, binds nothing the double could run on.
  if (!computeBind?.entries || !DAG_STAGES.has(stage ?? '')) return
  // A pool's queue on its sort's own group, by the program its pipeline runs (`fakePoolSorts.ts`).
  if (stage === 'poolScatter') {
    const poolSort = poolSortReplayOf(computePipeline?.module?.code ?? '')
    if (!poolSort) throw new Error('a pool sort the double does not replay')
    return poolSort(computeBind.entries, offsets)
  }
  // The selection binds one table per `DAG_SLOT` name: one missing is a validation error.
  const slots = Object.keys(DAG_SLOT).length
  if (computeBind.entries.length !== slots)
    throw new Error(`dag selection bind group requires ${slots} entries`)
  // A record table reads as its texture's words, laid as its buffer was (`dag/cut/cutTables.ts`).
  const byBinding = new Map(computeBind.entries.map((e) => [e.binding, boundData(e.resource)]))
  const boundWorlds = boundResource(computeBind.entries, DAG_SLOT.worlds),
    boundFrames = boundResource(computeBind.entries, DAG_SLOT.frames)
  // A test that hands no DAG reads the one the session uploaded (`fakeDag.ts`).
  const dag = packed ?? packedFromBindings(byBinding, boundWorlds, boundFrames),
    listCap = boundListCap(byBinding)
  if (stage !== 'dagWanted') return
  const { uniforms } = readDagUniforms(byBinding.get(DAG_SLOT.cutView)!.data)
  // The rule's residency lives in bits behind the cold records: the double rereads it through the
  // shared decoder, in the buffer the host writes, where the shader reads it.
  const cold = words(byBinding.get(DAG_SLOT.cold)!.data)
  const resident = {
    ready: residentFlags(cold, dag.pageCount),
    childReady: residentFlags(cold, dag.pageCount, childBase(dag.pageCount)),
  }
  // World matrices are read IN THE BOUND TABLE, where the shader reads them, each translation at
  // the eye of the same uniform block as the kernel reads it (`fakeWorldPose.ts`): the view and
  // planes are of that frame. A copy made at packing would put absolute worlds under a view with no
  // translation — two frames in one formula, and not a single page kept.
  const worlds = worldsAtEye(
    viewTexture(boundWorlds),
    byBinding.get(DAG_SLOT.cutView)!.data,
    dag.worlds.length,
  )
  // So is each primitive's root, its frame row's root word: a parked one is NONE (`parkWorld`),
  // and the cut skips it as the shader does.
  const rootNodes = dag.rootNodes.map((_, w) => frameWord(boundFrames, w, ROOT_WORD))
  const result = evaluateDagSelectionKernel(
    { ...dag, worlds, rootNodes },
    uniforms,
    resident,
    undefined,
    descentLevels(dag),
  )
  const work = byBinding.get(DAG_SLOT.work)!.data
  const ints = words(byBinding.get(DAG_SLOT.out)!.data)
  // A blended cluster is drawn by the blend pass: its bit in the frame's mask (`markBlended`).
  const mask = drawMask(work, dag.pageCount)
  mask.fill(0, 0, bitWords(dag.pageCount))
  writeVisibleList(
    words(byBinding.get(DAG_SLOT.visible)!.data),
    words(byBinding.get(DAG_SLOT.cutView)!.data)[viewWord('visCap')],
    dag,
    result.drawablePageIds ?? [],
    mask,
  )
  ints[1] = result.frustumRejected
  ints[2] = result.lodLevel
  writeTriangleTotals(ints, result)
  // The camera's requests, in the order the oracle asks them (`requestPage`): each leaf's first
  // page at its rank of the first list, its page count and its priority at the same rank of their
  // lists (`countWord`, `priorityWord`).
  const { pages, counts, priorities } = result.requests,
    at = priorityWord(listCap),
    countAt = countWord(listCap)
  ints[0] = pages.length
  // Past the cap a request is dropped and the sample says it is truncated (`requestPage`).
  ints[3] = pages.length > listCap ? 1 : 0
  // What the cut asked of its lists, in the drawn list's header (`dagFinish`): the double's cut is
  // whole, every node of its levels opened in one pass.
  const peaks = listWords(listCap),
    { levels, candidates, live } = result.work
  ints[peaks + PEAK_NODES] = levels.reduce((sum, level) => sum + level, 0)
  ints[peaks + PEAK_CANDIDATES] = candidates
  ints[peaks + PEAK_VISIBLE] = live
  // The drawn list (`dagDrawn`): the pages of the visible clusters behind the second header.
  const drawn = result.drawablePageIds ?? []
  ints[peaks] = drawn.length
  for (let k = 0; k < Math.min(listCap, drawn.length); k++)
    ints[peaks + SELECTION_HEADER_WORDS + k] = drawn[k]
  for (let s = 0; s < Math.min(listCap, pages.length); s++) {
    ints[SELECTION_HEADER_WORDS + s] = pages[s]
    ints[countAt + s] = counts[s]
    ints[at + s] = priorities[s]
  }
}

/**
 * The list of visible clusters the cluster cull writes (`dagWanted`): every cluster the cut draws,
 * the blended ones in the software list, the others in the hardware one — no cluster's edge is
 * measured on the double, and an unmeasured edge is the hardware raster's —, from the top of the
 * records, in the order of the cut; no post pass is open. A blended cluster the list had room for
 * takes its bit in `mask`, the blend pass's (`drawCluster`): one it had none for takes none.
 */
export function writeVisibleList(
  visible: Uint32Array,
  cap: number,
  dag: PackedDag,
  drawn: readonly number[],
  mask: Uint32Array,
) {
  const records = dagRecords(dag)
  visible[VIS_SW] = 0
  visible[VIS_HW] = 0
  visible[VIS_SW_SPLIT] = NO_SPLIT
  visible[VIS_HW_SPLIT] = NO_SPLIT
  visible[VIS_ASKED] = 0
  for (const id of drawn) {
    // The room is taken from the one count of asks first (`visibleAppend`): past it a cluster is
    // counted as asked, written nowhere, and neither list holds it.
    if (visible[VIS_ASKED]++ >= cap) continue
    const blended = (flagsOf(records, id) & CLUSTER_TRANSPARENT) !== 0
    if (blended) setBit(mask, id)
    const k = blended ? visible[VIS_SW]++ : visible[VIS_HW]++
    const v = blended ? k : cap - 1 - k
    const at = VISIBLE_HEADER_WORDS + VISIBLE_RECORD_WORDS * v
    visible[at] = id
    visible[at + 1] = worldOf(records, id)
    visible[at + 2] = blended ? VIS_TAG_BLENDED : 0
  }
}
