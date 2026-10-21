import { FLAG_MORPH, FLAG_SKIN, FLAG_SOFT_SOURCE } from '../../../sdk-core/src/page/format.ts'
import type { BankTrack } from '../../../sdk-core/src/scene/core/animationBanks.ts'
import type { ClusterRoot, DeformationOutput, PageRec } from '../geometry/selection/types.ts'

import type { HostAttributes } from '../session/host/resources.ts'
import { DEFORM_SHARED, ROW_WORDS } from '../visibility/types.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { rootOfPacked } from '../geometry/selection/placements.ts'
import { ownPageRow } from '../geometry/rows/state.ts'
import { PAGE_INFO } from '../visibility/pageInfo.ts'
import type { PlacementRows } from '../placement/rows/rows.ts'
import type { SharedOutputs } from './bankTracks.ts'
import { createRootTracks } from './rootTracks.ts'

/** The words a vertex's results start with: its owner's tag, then its image's; a block's address
 *  lies past the first vertex's. */
export const DEFORM_TAG_WORDS = 2
/** Where each result of a vertex lies from its address, three floats each: its current position,
 *  its previous one, its current normal — what the stage writes and the page passes read. */
export const DEFORMED_FIELD = { position: 0, previous: 3, normal: 6 } as const
/** Words per vertex: the tags, then the three results. */
export const DEFORM_VERTEX_WORDS = DEFORM_TAG_WORDS + 3 * 3

/** The word a row or a transparent span carries to name the results of a page and a placement
 *  (`ClusterRoot.deformationOutputs`): their first float plus one, in the float pool, zero for
 *  none; a bank track's block carries `DEFORM_SHARED` above its address. */
export const deformOutputWord = (output: DeformationOutput | undefined) =>
  output ? (output.from + 1) | (output.shared ? DEFORM_SHARED : 0) : 0

/** The vertices a page's own row deforms: none for a float-pool block, which one row of the
 *  pool's table deforms once for every page that reads it (`pooledRows.ts`); every one for a bank
 *  track's block, which the row of each placement playing the track deforms, a row leaving a
 *  vertex another row already deformed in this image (`computeWgsl.ts`). */
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
const animates = (
  mesh:
    { skeleton?: unknown; waves?: unknown; morphTargetInfluences?: unknown[] } | null | undefined,
) => !!mesh && (!!mesh.skeleton || !!mesh.waves || !!mesh.morphTargetInfluences?.length)

/** Whether a page asks for results by itself: its node animates, the host rewrites its geometry,
 *  or it carries a skin, a morph or a soft source. */
const pageDeforms = (page: PageRec) =>
  animates(page.drawSource?.node) ||
  !!page.drawSource?.dynamic ||
  !!((page.geometryPage?.flags ?? 0) & (FLAG_SOFT_SOURCE | FLAG_SKIN | FLAG_MORPH))

/** Asks whether one of the meshes that own the rows of a placement animates, once per rows for
 *  one pass over roots: every root of a batch reads the same rows, whose meshes can number a
 *  hundred thousand, so asking them again for each root is quadratic. */
export function createRowsAnimate() {
  const known = new Map<object, boolean>()
  return (rows: { sourceModels?: ReadonlySet<object> } | undefined) => {
    if (!rows?.sourceModels) return false
    let animate = known.get(rows)
    if (animate === undefined) {
      animate = false
      for (const mesh of rows.sourceModels) if ((animate = animates(mesh))) break
      known.set(rows, animate)
    }
    return animate
  }
}

export type RowsAnimate = ReturnType<typeof createRowsAnimate>

/** The vertices of a page, its results' length. */
const pageVertices = (page: PageRec) =>
  page.geometryPage?.vertexCount ?? page.attributes.position?.count ?? 0

/** Whether rows `rows` hold sources none of which can ever be one — sources and no source models:
 *  the parked row of a streamed node's own mesh, which the rows its main cell places draw
 *  (`../scene/host/prepared/placed.ts`). Its root takes neither a record nor results. */
export const unsourced = (rows: PlacementRows | undefined) => !!rows?.sources && !rows.sourceModels

/** Whether a root's pages get results of their own (`assignDeformationOutputs`): one with
 *  vertices deforms by itself, or the meshes owning the root's rows animate. */
export const rootHasOutputs = (root: ClusterRoot<PageRec>, rowsAnimate: RowsAnimate) => {
  const rows = root.placement?.rows,
    animate = rowsAnimate(rows)
  return (
    !unsourced(rows) &&
    root.pages.some((page) => (animate || pageDeforms(page)) && pageVertices(page) > 0)
  )
}

/** The blocks the roots playing each of `tracks` share for the page list of `root`, kept in
 *  `shared`, made when the first root of that list joins: one a page drawn from its quantized
 *  page, flagged shared (`deformOutputWord`); a page the passes read as floats is drawn at rest.
 *  The blocks made join `blocks`. */
function shareOutputs(
  root: ClusterRoot<PageRec>,
  tracks: readonly BankTrack[],
  shared: SharedOutputs,
  blocks: DeformationOutput[],
) {
  let byTrack = shared.get(root.pages)
  if (!byTrack) shared.set(root.pages, (byTrack = new Map()))
  for (const track of tracks) {
    if (byTrack.has(track)) continue
    let outputs: (DeformationOutput | undefined)[] | undefined
    root.pages.forEach((page, k) => {
      const count = page.geometryPage ? pageVertices(page) : 0
      if (!count) return
      const output: DeformationOutput = { from: 0, count, shared: true }
      blocks.push(output)
      ;(outputs ??= new Array(root.pages.length))[k] = output
    })
    byTrack.set(track, outputs)
  }
}

/**
 * The results of the deformation, in the float pool: one block of floats, eleven a vertex behind
 * two tags, for each page a placement deforms (`ClusterRoot.deformationOutputs`, by the page's
 * rank in the root), so that two placements of one primitive — the rows of a crowd, each with its own
 * pose — never write the same vertices. A page drawn from its quantized page has a block of its
 * own, deformed by its own row; the pages of a geometry the passes read as floats share one block
 * a placement, which one row of the pool's table deforms once (`pooledRows.ts`). A root that can
 * play a bank's tracks (`createRootTracks`) has blocks of its own only for its rows' moving
 * sources, and shares with every root of its page list one block a page for each track
 * (`trackOutputs`, the session's: `bankTracks.ts`), every one of them in one pose. The blocks lie
 * after the records in the pool's tail (`pooledDeformationRows`), their first
 * float set when the tail is laid out. Returns the blocks made, in order.
 */
export function assignDeformationOutputs(
  roots: readonly ClusterRoot<PageRec>[],
  trackOutputs?: SharedOutputs,
) {
  const blocks: DeformationOutput[] = []
  const wanting = new WeakMap<readonly PageRec[], boolean[]>()
  const rowsAnimate = createRowsAnimate(),
    playable = createRootTracks()
  for (const root of roots) {
    const rows = root.placement?.rows,
      tracks = playable(root)
    if (trackOutputs && tracks.length) shareOutputs(root, tracks, trackOutputs, blocks)
    if (unsourced(rows)) {
      root.deformationOutputs = undefined
      continue
    }
    let want = wanting.get(root.pages)
    if (!want) wanting.set(root.pages, (want = root.pages.map(pageDeforms)))
    // A root playing a bank's tracks deforms by itself only through its rows' sources.
    const animate = rowsAnimate(rows),
      alone = !tracks.length
    // Made on the first float page that deforms: a still root allocates nothing.
    let shared: Map<HostAttributes, DeformationOutput> | undefined
    let outputs: (DeformationOutput | undefined)[] | undefined
    root.pages.forEach((page, k) => {
      const count = animate || (alone && want[k]) ? pageVertices(page) : 0
      if (!count) return
      let output: DeformationOutput | undefined
      if (page.geometryPage) blocks.push((output = { from: 0, count }))
      else {
        output = (shared ??= new Map()).get(page.attributes)
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
    root.deformationOutputs = outputs
  }
  return blocks
}

/** The rows of `root`'s pages — a blended page's caster row — and its transparent spans pointed at
 *  what it reads now, the record word `record` and its pages' results
 *  (`ClusterRoot.deformationOutputs`), as `followPooledBlocks` points every row: a root whose bank
 *  track started or stopped animating (`bankTracks.ts`), before the next image's deformation reads
 *  them. */
export function followRootBlocks(
  rt: Pick<WebgpuPagesRuntime, 'layout' | 'blendState'>,
  root: ClusterRoot<PageRec>,
  record: number,
) {
  const { rows } = rt.layout,
    { table, dirtySpans } = rt.blendState,
    ints = rows.pageTableInts,
    base = root.packedBase ?? -1
  for (let page = 0; base >= 0 && page < root.pages.length; page++) {
    const output = root.deformationOutputs?.[page],
      row = ints ? ownPageRow(rows, base + page, !!root.pages[page].transparent) : -1
    if (ints && row >= 0) {
      ints[row * ROW_WORDS + PAGE_INFO.at.deform] = record
      writeRowDeformation(ints, row * ROW_WORDS, output)
      rows.markRowWords(row)
    }
    const entry = table ? table.entryOf(base + page) : -1,
      drawn = entry < 0 ? 0 : table!.spans[entry * 4 + 1]
    if (!drawn) continue
    writeSpanDeformation(table!.spans, entry, output, drawn)
    dirtySpans.mark(entry)
  }
}

/** The tail of the float pool laid out again moves the deformation block and the result blocks
 *  (`SessionDeformation.place`, `pooledRows.ts`). The rows that read a record or a block, and the
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
    dirtySpans.mark(entry)
  }
}
