/**
 * THE SIZES OF A CHUNKED RASTER'S LISTS (`renderPass.ts`, the transmission's bin): the lists by
 * name, what each takes for a chunk of rows, and the one sizing both rasters rewrite each frame
 * (`vsmSizingFor`); the rows a chunk takes within the room are `chunkLists.ts`'s.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { UniformSlots } from '../residency/pools.ts'
import { VSM_RENDER_CANDIDATE_BYTES, VSM_RENDER_CMD_BYTES } from './constants.ts'
import { VSM_RENDER_ARGS_STRIDE_WORDS, VSM_RENDER_COUNTS_HEAD } from './renderParamsWgsl.ts'
import type { VsmChunk } from './rowPageBound.ts'

/** The lists a chunked raster holds, by name. */
export type VsmListName = 'params' | 'views' | 'candidates' | 'counts' | 'cmds' | 'pairs' | 'args'

/** Bytes of each list a chunk takes, by buffer (`vsmChunkListSizes`). */
export type VsmListSizes = Record<VsmListName, number>

/** The rows a chunk takes within the room, and its lists' sizes; none when not even one row's
 *  lists fit (`vsmChunkRowsWithin`). */
export interface VsmWithin<S> {
  rows: number
  size?: S
  limited: boolean
}

/**
 * How a chunked raster's lists are sized, rewritten by each frame: `chunked` rows drawn in chunks
 * over `candidates` candidate rows, `viewWords` words of views, a chunk holding `holds`, its
 * parameter slots `slots`, `pairBytes` a pair and `headerBytes` a command in the pairs' list (the
 * transmission's page list heads each command). Its sizes, `sizes` and `within` are made once and
 * rewritten in place: a frame allocates nothing.
 */
export interface VsmListSizing {
  chunked: number
  candidates: number
  viewWords: number
  holds?: Omit<VsmChunk, 'rows'>
  slots?: UniformSlots
  readonly pairBytes: number
  readonly headerBytes: number
  readonly size: VsmListSizes
  readonly sizes: (rows: number) => VsmListSizes
  readonly within: VsmWithin<VsmListSizes>
}

/** A sizing of `pairBytes` a pair and `headerBytes` a command (`VsmListSizing`). */
export function vsmListSizing(pairBytes: number, headerBytes: number) {
  const sizing: VsmListSizing = {
    chunked: 0,
    candidates: 0,
    viewWords: 0,
    pairBytes,
    headerBytes,
    size: { params: 0, views: 0, candidates: 0, counts: 0, cmds: 0, pairs: 0, args: 0 },
    sizes: (rows) => vsmChunkListSizes(sizing, rows),
    within: { rows: 0, limited: false },
  }
  return sizing
}

/** The lists a chunk of `rows` rows takes under `sizing`, by buffer, written into its `size`. */
function vsmChunkListSizes(sizing: VsmListSizing, rows: number) {
  const { size, holds } = sizing,
    chunks = ceilDiv(sizing.chunked, rows)
  size.params = chunks * sizing.slots!.stride
  size.views = sizing.viewWords * 4
  size.candidates = sizing.candidates * VSM_RENDER_CANDIDATE_BYTES
  size.counts = (VSM_RENDER_COUNTS_HEAD + chunks * 4) * 4
  size.cmds = holds!.cmds(rows) * VSM_RENDER_CMD_BYTES
  size.pairs = holds!.cmds(rows) * sizing.headerBytes + holds!.pairs(rows) * sizing.pairBytes
  size.args = chunks * VSM_RENDER_ARGS_STRIDE_WORDS * 4
  return size
}

/** `sizing` for `chunked` rows drawn in chunks over `candidates` candidate rows, under `viewWords`
 *  words of views, a chunk holding `holds`, its parameter slots `slots` (`VsmListSizing`): the
 *  opaque raster's and the transmission's one writer; rewritten in place. */
export function vsmSizingFor(
  sizing: VsmListSizing,
  chunked: number,
  candidates: number,
  viewWords: number,
  holds: Omit<VsmChunk, 'rows'>,
  slots: UniformSlots,
) {
  sizing.chunked = chunked
  sizing.candidates = candidates
  sizing.viewWords = viewWords
  sizing.holds = holds
  sizing.slots = slots
  return sizing
}
