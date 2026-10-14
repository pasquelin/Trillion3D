/**
 * THE ROWS THE CPU NAMES TO THE ROWS PASS (`rowWords.ts`, `rowWordsPass.ts`), a list the pass reads
 * a thread an entry: each row once however often it is named — its place among them is kept a row
 * (`at`), so a row two reasons or two pumps name in a frame takes one entry, its bits joined
 * (`ROW_EMITS`, `ROW_STALES`). While every row is derived (`all`) the list keeps the rows whose
 * shadow changed where they stand alone: deriving a row finds no such change. A command buffer
 * holding the pass that is dropped has every row derived again, and the rows it staled named again
 * (`rowWordsDropped`): the spheres it would have read are the ones the GPU still holds.
 */
import { resized } from '../../../math/src/sequence/resized.ts'
import type { RowWords } from './rowWords.ts'
import { ROW_EMITS, ROW_NAMED, ROW_STALES } from './rowWordsWgsl.ts'

/** Row `row` derived at the next pass, with `bits` (`ROW_EMITS`, `ROW_STALES`): a row named already
 *  keeps its place and joins them. While every row is derived, a row staled alone is listed. */
export function target(state: RowWords, row: number, bits = 0) {
  if (state.all && !(bits & ROW_STALES)) return
  state.at = resized(state.at, row + 1)
  let place = state.at[row] - 1
  if (place < 0) {
    state.targets = resized(state.targets, state.count + 1)
    state.targets[(place = state.count)] = row
    state.at[row] = ++state.count
  }
  const was = state.targets[place]
  if (bits & ~was & ROW_EMITS) state.emits++
  if (bits & ~was & ROW_STALES) state.stales++
  state.targets[place] = (was | bits) >>> 0
}

/** The rows named forgotten: every row is derived, its shadows staled anew (`spheresMadeAnew`). */
export function forgetTargets(state: RowWords) {
  for (let k = 0; k < state.count; k++) state.at[state.targets[k] & ROW_NAMED] = 0
  state.count = state.emits = state.stales = 0
}

/** Every row derived at the next pass: the rows named forgotten but those staled, which deriving
 *  finds no change of. */
export function deriveEveryRow(state: RowWords) {
  state.all = true
  let kept = 0
  for (let k = 0; k < state.count; k++) {
    const word = state.targets[k],
      row = word & ROW_NAMED
    state.at[row] = 0
    if (!(word & ROW_STALES)) continue
    state.targets[kept] = (row | ROW_STALES) >>> 0
    state.at[row] = ++kept
  }
  state.count = state.stales = kept
  state.emits = 0
}

/** The pass encoded into `encoder` took the rows named: the staled ones kept until the next, their
 *  command buffer may be dropped, and the list emptied. */
export function targetsTaken(state: RowWords, encoder: GPUCommandEncoder) {
  let n = 0
  for (let k = 0; k < state.count; k++) {
    if (!(state.targets[k] & ROW_STALES)) continue
    state.staled = resized(state.staled, n + 1)
    state.staled[n++] = state.targets[k] & ROW_NAMED
  }
  state.staledCount = n
  state.all = false
  forgetTargets(state)
  state.encodedInto = encoder
}

/** The command buffer `dropped` never ran: when it held the pass, every row is derived again and
 *  the rows it staled are named again, from the spheres the GPU still holds — no page staled more. */
export function rowWordsDropped(state: RowWords | undefined, dropped: GPUCommandEncoder) {
  if (!state || state.encodedInto !== dropped) return
  state.encodedInto = undefined
  deriveEveryRow(state)
  for (let k = 0; k < state.staledCount; k++) target(state, state.staled[k], ROW_STALES)
  state.staledCount = 0
}
