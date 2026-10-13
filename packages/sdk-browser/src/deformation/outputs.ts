import { FLAG_MORPH, FLAG_SKIN, FLAG_SOFT_SOURCE } from '../../../sdk-core/src/page/format.ts'
import type { ClusterRoot, DeformationOutput } from '../page/selection/types.ts'
import type { PageRec } from '../page/selection/selection.ts'
import type { HostAttributes } from '../host/resources.ts'
import { DEFORM_SOURCE_IN_POOL, DEFORM_NO_HEADER, ROW_WORDS } from '../visibility/types.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { rootOfPacked } from '../page/selection/placements.ts'
import { PAGE_INFO } from '../visibility/pageInfo.ts'

/** Current position, previous position and current normal: eleven words per vertex, including owner and frame tags. */
export const DEFORM_VERTEX_WORDS = 11

/** The word a row or a transparent span carries to name the results of a page and a placement
 *  (`ClusterRoot.deformationOutputs`): their first float plus one, in the float pool, zero for none.
 *  The block of a float geometry is marked as one with no source header, its source lying in the
 *  pool as well; a page's own results keep the source in the slot, whose header the row reads. */
export const deformOutputWord = (output: DeformationOutput | undefined) =>
  !output
    ? 0
    : output.pool
      ? ((output.from + 1) | DEFORM_SOURCE_IN_POOL | DEFORM_NO_HEADER) >>> 0
      : output.from + 1

/** The vertices a page's own row deforms: none for a float-pool block, which one row of the
 *  pool's table deforms once for every page that reads it (`wholePool.ts`). */
const deformCountWord = (output: DeformationOutput | undefined) =>
  output && !output.pool ? output.count : 0

/** Names `output` in the page-table row at word `at` (`row * ROW_WORDS`): the words
 *  the row's own deformation reads (`deformCountWord`, `deformOutputWord`). The one writer of them
 *  for a row, at its first write and when the pool's tail is laid out again. */
export function writeRowDeformation(
  ints: Uint32Array,
  at: number,
  output: DeformationOutput | undefined,
) {
  ints[at + PAGE_INFO.at.deformCount] = deformCountWord(output)
  ints[at + PAGE_INFO.at.deformOutput] = deformOutputWord(output)
}

/** Names `output` in the transparent span `entry` (output word, then count word), zero when the
 *  span `drawn` nothing. The one writer of them for a span, at its first write and when the pool's
 *  tail is laid out again. */
export function writeSpanDeformation(
  spans: Uint32Array,
  entry: number,
  output: DeformationOutput | undefined,
  drawn: number,
) {
  spans[entry * 4 + 2] = drawn ? deformOutputWord(output) : 0
  spans[entry * 4 + 3] = drawn ? deformCountWord(output) : 0
}

/** Whether a mesh is moved by a skeleton, morph weights or waves. */
export const animates = (
  mesh:
    { skeleton?: unknown; waves?: unknown; morphTargetInfluences?: unknown[] } | null | undefined,
) => !!mesh && (!!mesh.skeleton || !!mesh.waves || !!mesh.morphTargetInfluences?.length)

/** Whether a page asks for results by itself: its node animates, the host rewrites its geometry,
 *  or it carries a skin, a morph or a soft source. */
export const pageDeforms = (page: PageRec) =>
  animates(page.drawSource?.node) ||
  !!page.drawSource?.dynamic ||
  !!((page.geometryPage?.flags ?? 0) & (FLAG_SOFT_SOURCE | FLAG_SKIN | FLAG_MORPH))

/** Whether one of the meshes that own the rows of a placement animates. */
export const rowsAnimate = (rows: { sourceModels?: ReadonlySet<object> } | undefined) =>
  [...(rows?.sourceModels ?? [])].some(animates)

/**
 * The results of the deformation, in the float pool: one block of floats, eleven a vertex behind
 * two tags, for each page a placement deforms (`ClusterRoot.deformationOutputs`, by the page's
 * rank in the root), so that two placements of one primitive — the rows of a crowd, each with its own
 * pose — never write the same vertices. A page drawn from its quantized page has a block of its
 * own, deformed by its own row; the pages of a geometry the passes read as floats share one block
 * a placement, which one row of the pool's table deforms once (`wholePool.ts`). The blocks lie
 * after the records and the whole copies in the pool's tail (`wholeDeformationPool`), their first
 * float set when the tail is laid out. Returns the blocks made, in order.
 */
export function assignDeformationOutputs(roots: readonly ClusterRoot<PageRec>[]) {
  const blocks: DeformationOutput[] = []
  const wanting = new WeakMap<readonly PageRec[], boolean[]>()
  for (const root of roots) {
    delete root.deformationOutputs
    let want = wanting.get(root.pages)
    if (!want) wanting.set(root.pages, (want = root.pages.map(pageDeforms)))
    const animate = rowsAnimate(root.placement?.rows),
      shared = new Map<HostAttributes, DeformationOutput>()
    let outputs: (DeformationOutput | undefined)[] | undefined
    root.pages.forEach((page, k) => {
      if (!want[k] && !animate) return
      const count = page.geometryPage?.vertexCount ?? page.attributes.position?.count ?? 0
      if (!count) return
      let output: DeformationOutput | undefined
      if (page.geometryPage) blocks.push((output = { from: 0, count }))
      else {
        output = shared.get(page.attributes)
        if (!output) {
          shared.set(
            page.attributes,
            (output = { from: 0, count, pool: { attributes: page.attributes, world: root.world } }),
          )
          blocks.push(output)
        }
      }
      ;(outputs ??= new Array(root.pages.length))[k] = output
    })
    if (outputs) root.deformationOutputs = outputs
  }
  return blocks
}

/** The tail of the float pool laid out again moves the deformation block and the result blocks
 *  (`SessionDeformation.place`, `wholePool.ts`). The rows that read a record or a block, and the
 *  transparent spans that read a block, are pointed at them again, before the next image's
 *  deformation reads them. */
export function followPooledBlocks(rt: Pick<WebgpuPagesRuntime, 'layout' | 'blendState' | 'vis'>) {
  const { rows, deformationOutputOf, placement } = rt.layout,
    { deformation } = rt.vis,
    ints = rows.pageTableInts
  for (let row = 0; ints && row < rows.packedRecs.length; row++) {
    if (!rows.packedRecs[row]) continue
    const at = row * ROW_WORDS,
      page = rows.packedPageIndex[row],
      // The record word the row writer gives the row's placement (`pageRowWriter.ts`).
      record = deformation?.rowWord(rootOfPacked(placement, page)) ?? 0,
      output = deformationOutputOf(page)
    if (!output && record === ints[at + PAGE_INFO.at.deform]) continue
    ints[at + PAGE_INFO.at.deform] = record
    writeRowDeformation(ints, at, output)
    rows.markRowWords(row)
  }
  const { table, dirtySpans } = rt.blendState
  for (let entry = 0; table && entry < table.pageOfEntry.length; entry++) {
    const page = table.pageOfEntry[entry],
      output = page < 0 ? undefined : deformationOutputOf(page)
    if (!output || !table.spans[entry * 4 + 1]) continue
    writeSpanDeformation(table.spans, entry, output, table.spans[entry * 4 + 1])
    dirtySpans.add(entry)
  }
}
