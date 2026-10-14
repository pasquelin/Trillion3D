/**
 * THE ROWS A PARENT COMPOSES THAT NO ROOT READS: a blended surface's rows, which only its copies
 * read, and rows whose root a growth has not built yet. They follow the parent like any linked row
 * — the link is accepted whatever reads the row —, but no roots pass writes their world: it is the
 * composition's product, `parent · local` by `multiplyMatrix4`, the product the GPU's doubles equal
 * (`gpuComposeWgsl.ts`), written into the row the first time one of its views is read since the
 * parent moved (`readThroughViews`), never at the move: a reader costs one product a read, a move of
 * the parent none. Every reader of such a row reads it through a view — a blended copy's or item's
 * `matrix` (`../webgpu/blend/prepare.ts`) —, never the rows' buffer itself (`rowReaders.test.ts`).
 * A growth that brings a row its root hands the link to the roots pass (`adoptReaders`): from then
 * on the GPU composes it, and this module holds none.
 */
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import type { MatrixElements } from '../host/matrixElements.ts'
import type { PlacementRows } from './rows.ts'

/** A row held by its parent's slot, composed for its readers. */
type RowReader = {
  parent: object
  rows: PlacementRows
  readonly index: number
  /** The row's local matrix as linked: a copy, never the owner's view. */
  readonly local: Float64Array
  /** Its slot's version the row was last composed at; -1 before any. */
  at: number
}

/** The readers of each slot. */
export type Readers = Map<number, RowReader[]>

/** The views a reader's row is read through, by its rows and its rank there. */
export type ReaderViews = (rows: PlacementRows, index: number) => readonly MatrixElements[]

/** What a view composes from: each slot's version and the parents' worlds, read at the read. */
type Composition = { readonly slotVersions: readonly number[]; readonly worlds: Float64Array }

/** The views this module made read through their row's composition. */
const composing = new WeakSet<MatrixElements>()

/** `links` become readers of `slot` (`parent`) — every reader it has when the slot held none, as
 *  a whole link deletes them first. A reader held already takes its new local in place: the views
 *  reading through it follow. */
export function holdReaders(
  readers: Readers,
  slot: number,
  parent: object,
  links: readonly { rows: PlacementRows; index: number; local: ArrayLike<number> }[],
) {
  let held = readers.get(slot)
  if (!held) readers.set(slot, (held = []))
  // Where each row the slot holds stands in its list: a link finds its reader in one look.
  const at = new Map<PlacementRows, Map<number, number>>()
  const atOf = (rows: PlacementRows) => at.get(rows) ?? at.set(rows, new Map()).get(rows)!
  held.forEach(({ rows, index }, k) => atOf(rows).set(index, k))
  for (const { rows, index, local } of links) {
    const k = atOf(rows).get(index)
    if (k === undefined) {
      const reader = { parent, rows, index, local: Float64Array.from(local), at: -1 }
      atOf(rows).set(index, held.push(reader) - 1)
      continue
    }
    Object.assign(held[k], { parent, at: -1 }).local.set(local)
  }
  if (!held.length) readers.delete(slot)
}

/** A growth replaced the rows `from` by `to`, larger, with the same rows in place: the readers
 *  that held `from` hold `to`, composed again at their next read. */
export function rebindReaders(readers: Readers, from: PlacementRows, to: PlacementRows) {
  for (const held of readers.values())
    for (const reader of held) if (reader.rows === from) Object.assign(reader, { rows: to, at: -1 })
}

/** `view` reads `reader`'s row composed under slot `slot` of `composition`, the first time it is
 *  read since the slot's composition moved. A view another getter serves already — a root's composed
 *  world, the same product — is left to it. */
function readThrough(view: MatrixElements, reader: RowReader, slot: number, at: Composition) {
  if (Object.getOwnPropertyDescriptor(view, 'elements')?.get) return
  const elements = view.elements as Float64Array
  composing.add(view)
  Object.defineProperty(view, 'elements', {
    configurable: true,
    enumerable: true,
    get: () => {
      if (reader.at !== at.slotVersions[slot]) {
        reader.at = at.slotVersions[slot]
        multiplyMatrix4(elements, at.worlds.subarray(slot * 16, slot * 16 + 16), reader.local)
      }
      return elements
    },
  })
}

/** The views (`viewsOf`) of the readers of `slot` read their rows composed (`readThrough`). */
export function readThroughViews(
  readers: Readers,
  slot: number,
  viewsOf: ReaderViews,
  composition: Composition,
) {
  for (const reader of readers.get(slot) ?? [])
    for (const view of viewsOf(reader.rows, reader.index))
      readThrough(view, reader, slot, composition)
}

/** The views of `slot`'s readers are plain again, holding the world they were last read at: their
 *  readers leave the slot. */
export function releaseReaderViews(readers: Readers, slot: number, viewsOf: ReaderViews) {
  for (const reader of readers.get(slot) ?? []) releaseViews(reader, viewsOf)
}

function releaseViews(reader: RowReader, viewsOf: ReaderViews) {
  for (const view of viewsOf(reader.rows, reader.index)) {
    if (!composing.has(view)) continue
    composing.delete(view)
    Object.defineProperty(view, 'elements', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: view.elements,
    })
  }
}

/**
 * The readers of every slot that a root now reads, taken out of the table — their views plain
 * again — and returned by parent: the caller links them as rooted rows. `rankOf`: the root of a
 * row, negative when none.
 */
export function adoptReaders(
  readers: Readers,
  rankOf: (rows: PlacementRows, index: number) => number,
  viewsOf: ReaderViews,
) {
  const adopted: { slot: number; parent: object; readers: RowReader[] }[] = []
  for (const [slot, held] of readers) {
    const roots = held.filter(({ rows, index }) => rankOf(rows, index) >= 0)
    if (!roots.length) continue
    for (const reader of roots) releaseViews(reader, viewsOf)
    const rest = held.filter((reader) => !roots.includes(reader))
    if (rest.length) readers.set(slot, rest)
    else readers.delete(slot)
    adopted.push({ slot, parent: roots[0].parent, readers: roots })
  }
  return adopted
}
