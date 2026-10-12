/**
 * THE ROWS A PARENT COMPOSES THAT NO ROOT READS: a blended surface's rows, which only its copies
 * read, and rows whose root a growth has not built yet. They follow the parent like any linked row
 * — the link is accepted whatever reads the row —, but no roots pass writes their world: it is the
 * composition's product, `parent · local` by the same `multiplyMatrix4` the GPU's doubles equal
 * (`gpuComposeWgsl.ts`), written into the row once a parent's world is taken (`writeReaders`), for
 * the CPU readers that hold the row in place. A growth that brings a row its root hands the link to
 * the roots pass (`adoptReaders`): from then on the GPU composes it, and this module holds none.
 */
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import type { PlacementRows } from './rows.ts'

/** A row held by its parent's slot, composed for its readers. */
type RowReader = {
  readonly parent: object
  readonly rows: PlacementRows
  readonly index: number
  /** The row's local matrix as linked: a copy, never the owner's view. */
  readonly local: Float64Array
}

/** The readers of each slot. */
export type Readers = Map<number, RowReader[]>

/** `links` become the readers of `slot` (`parent`); `whole`: they are every reader it has. */
export function holdReaders(
  readers: Readers,
  slot: number,
  parent: object,
  links: readonly { rows: PlacementRows; index: number; local: ArrayLike<number> }[],
  whole: boolean,
) {
  let held = readers.get(slot)
  if (whole || !held) readers.set(slot, (held = []))
  for (const { rows, index, local } of links) {
    const at = held.findIndex((reader) => reader.rows === rows && reader.index === index)
    const reader = { parent, rows, index, local: Float64Array.from(local) }
    if (at < 0) held.push(reader)
    else held[at] = reader
  }
  if (!held.length) readers.delete(slot)
}

/** A growth replaced the rows `from` by `to`, larger, with the same rows in place: the readers
 *  that held `from` hold `to`. */
export function rebindReaders(readers: Readers, from: PlacementRows, to: PlacementRows) {
  for (const [slot, held] of readers)
    readers.set(
      slot,
      held.map((reader) => (reader.rows === from ? { ...reader, rows: to } : reader)),
    )
}

/** Every reader of `slot` is let go (its parent no longer composes it, or the rows are given up). */
export function dropReaders(readers: Readers, slot: number) {
  readers.delete(slot)
}

/** The rows `slot`'s readers hold are written at `world`, the parent's, times each local. */
export function writeReaders(readers: Readers, slot: number, world: ArrayLike<number>) {
  const held = readers.get(slot)
  if (!held) return
  const parent = world instanceof Float64Array ? world : Float64Array.from(world)
  for (const { rows, index, local } of held)
    if (index < rows.capacity)
      multiplyMatrix4(rows.matrices.subarray(index * 16, index * 16 + 16), parent, local)
}

/**
 * The readers of every slot that a root now reads, taken out of the table and returned by parent:
 * the caller links them as rooted rows. `rankOf`: the root of a row, negative when none.
 */
export function adoptReaders(
  readers: Readers,
  rankOf: (rows: PlacementRows, index: number) => number,
) {
  const adopted: { slot: number; parent: object; readers: RowReader[] }[] = []
  for (const [slot, held] of readers) {
    const roots = held.filter(({ rows, index }) => rankOf(rows, index) >= 0)
    if (!roots.length) continue
    const rest = held.filter((reader) => !roots.includes(reader))
    if (rest.length) readers.set(slot, rest)
    else readers.delete(slot)
    adopted.push({ slot, parent: roots[0].parent, readers: roots })
  }
  return adopted
}
