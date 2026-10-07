import { FLAG_MORPH, FLAG_SKIN, FLAG_SOFT_SOURCE } from '../cluster/format.ts'
import type { ClusterRoot, DeformationOutput } from '../page/selection/types.ts'
import type { PageRec } from '../page/selection/selection.ts'
import { pageAddress } from '../webgpu/row/pageSlots.ts'
import type { HostAttributes } from '../host/resources.ts'
import type { MatrixElements } from '../math/matrixElements.ts'
import {
  DEFORM_IN_POOL,
  DEFORM_NO_HEADER,
  PAGE_DEFORM_COUNT_WORD,
  PAGE_DEFORM_OUTPUT_WORD,
  PAGE_DEFORM_WORD,
  PAGE_INFO_STRIDE,
} from '../visibility/types.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** Current position, previous position and current normal: eleven words per vertex, including owner and frame tags. */
export const DEFORM_VERTEX_WORDS = 11

/** The word a row or a transparent span carries to name a page's results (`deformationOutput`),
 *  the page's slot starting at word `offset`: their first word plus one, zero for none; a float-pool
 *  block's first float plus one, marked in the pool with no source header. */
export const deformOutputWord = (output: DeformationOutput | undefined, offset: number) =>
  !output
    ? 0
    : output.pool
      ? ((output.from + 1) | DEFORM_IN_POOL | DEFORM_NO_HEADER) >>> 0
      : offset + output.from + 1

/** The vertices a page's own row deforms: none for a float-pool block, which one row of the
 *  pool's table deforms once for every page that reads it (`wholePool.ts`). */
const deformCountWord = (output: DeformationOutput | undefined) =>
  output && !output.pool ? output.count : 0

/** Names `output` in the page-table row at word `at` (`row * PAGE_INFO_STRIDE / 4`): the words
 *  the row's own deformation reads (`deformCountWord`, `deformOutputWord`). The one writer of them
 *  for a row, at its first write and when a pool grows. */
export function writeRowDeformation(
  ints: Uint32Array,
  at: number,
  output: DeformationOutput | undefined,
  offset: number,
) {
  ints[at + PAGE_DEFORM_COUNT_WORD] = deformCountWord(output)
  ints[at + PAGE_DEFORM_OUTPUT_WORD] = deformOutputWord(output, offset)
}

/** Names `output` in the transparent span `entry` (output word, then count word), zero when the
 *  span `drawn` nothing. The one writer of them for a span, at its first write and when a pool
 *  grows. */
export function writeSpanDeformation(
  spans: Uint32Array,
  entry: number,
  output: DeformationOutput | undefined,
  offset: number,
  drawn: number,
) {
  spans[entry * 4 + 2] = drawn ? deformOutputWord(output, offset) : 0
  spans[entry * 4 + 3] = drawn ? deformCountWord(output) : 0
}

/**
 * Reserve deformation results in the geometry cache's own slots. All placements sharing a
 * compressed page have disjoint tails; eviction, relocation, root coverage and the one geometry
 * budget therefore account for the results along with their source. No output spans slots.
 * Every tail starts past the widest page, `sourceBytes`, wherever its page lies: a page's own
 * width in `homes` (`../webgpu/row/pageSlots.ts`) is raised to its last tail's end, so the place
 * the pool gives it when the whole catalogue fits holds its tails at the same offsets.
 *
 * A page with no geometry page is drawn from the float pool, its corners naming its geometry's
 * vertices, not vertices of its own: its results are its geometry's, one block per geometry and
 * placement in the float pool (`pooledOutputs`), every page of them sharing it, never a tail in its
 * slot — a tail would hold the whole geometry for each page, a sea of 3 800 pages 1.8 MB each.
 */
export function deformationSlotBytes(
  pages: readonly PageRec[],
  sourceBytes: number,
  roots: readonly ClusterRoot<PageRec>[] = [],
  homes?: Map<string, number>,
) {
  const ends = new Map<string, number>()
  // One record serves every placement of its primitive: a page's placement is read from
  // the first root that places it, a per-page property.
  const rootOf = new Map<PageRec, ClusterRoot<PageRec>>()
  for (const root of roots)
    for (const page of root.pages) if (!rootOf.has(page)) rootOf.set(page, root)
  const blocks = new Map<HostAttributes, Map<MatrixElements | undefined, DeformationOutput>>()
  /** The float-pool block of `page`'s geometry and placement, made at its first page. */
  const pooled = (page: PageRec, count: number) => {
    const world = rootOf.get(page)?.world,
      byWorld = blocks.get(page.attributes) ?? new Map()
    blocks.set(page.attributes, byWorld)
    let output = byWorld.get(world)
    if (!output)
      byWorld.set(
        world,
        (output = { from: 0, count, pool: { attributes: page.attributes, world } }),
      )
    return output
  }
  let bytes = sourceBytes
  for (const page of pages) {
    delete page.deformationOutput
    const mesh = page.sourceMesh
    if (
      !mesh?.skeleton &&
      !mesh?.morphTargetInfluences?.length &&
      !mesh?.waves &&
      mesh?.geometry?.usage !== 'dynamic' &&
      !((page.geometryPage?.flags ?? 0) & (FLAG_SOFT_SOURCE | FLAG_SKIN | FLAG_MORPH)) &&
      ![...(rootOf.get(page)?.placement?.rows.sourceModels ?? [])].some((source) => source.waves)
    )
      continue
    const count = page.geometryPage?.vertexCount ?? page.attributes.position?.count ?? 0
    if (!count) continue
    if (!page.geometryPage) {
      page.deformationOutput = pooled(page, count)
      continue
    }
    const address = pageAddress(page)
    const from = ends.get(address) ?? sourceBytes / 4
    page.deformationOutput = { from: from + 2, count }
    const end = from + count * DEFORM_VERTEX_WORDS
    ends.set(address, end)
    bytes = Math.max(bytes, end * 4)
    homes?.set(address, Math.max(homes.get(address) ?? 0, end * 4))
  }
  return bytes
}

/** The float-pool blocks of `pages` (`deformationSlotBytes`), each once, in the pages' order. */
export const pooledOutputs = (pages: readonly PageRec[]) => {
  const outputs = new Set<DeformationOutput>()
  for (const page of pages) if (page.deformationOutput?.pool) outputs.add(page.deformationOutput)
  return [...outputs]
}

/** A growth of the float pool moves the deformation block after the wider vertices: its records
 *  (`SessionDeformation.place`) and the float-pool blocks of the pages drawn from it
 *  (`wholePool.ts`). The rows that read a record or a block, and the transparent spans that read a
 *  block, are pointed at them again, before the next image's deformation reads them. */
export function followPooledBlocks(rt: Pick<WebgpuPagesRuntime, 'layout' | 'blendState' | 'vis'>) {
  const { rows, recordOf, placement } = rt.layout,
    { deformation } = rt.vis,
    ints = rows.pageTableInts
  for (let row = 0; ints && row < rows.packedRecs.length; row++) {
    const rec = rows.packedRecs[row]
    if (!rec) continue
    const at = row * (PAGE_INFO_STRIDE / 4),
      output = rec.deformationOutput,
      // The record word the row writer gives the row's placement (`pageRowWriter.ts`).
      record = deformation?.rowWord(placement.rootOfPacked[rows.packedPageIndex[row]]) ?? 0
    if (record === ints[at + PAGE_DEFORM_WORD] && !output?.pool) continue
    ints[at + PAGE_DEFORM_WORD] = record
    if (output?.pool) writeRowDeformation(ints, at, output, 0)
    rows.markRowWords(row)
  }
  const { table, dirtySpans } = rt.blendState
  for (let page = 0; table && page < table.entryOfPage.length; page++) {
    const entry = table.entryOfPage[page],
      output = entry < 0 ? undefined : recordOf(page)?.deformationOutput
    if (!output?.pool || !table.spans[entry * 4 + 1]) continue
    writeSpanDeformation(table.spans, entry, output, 0, table.spans[entry * 4 + 1])
    dirtySpans.add(entry)
  }
}
