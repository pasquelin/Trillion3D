import { nodeWrites } from '../../../../sdk-core/src/scene/core/nodeEdits.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { rootSource } from '../../placement/hidden.ts'
import { rowFarField, rowFarFieldMoves } from '../../placement/rows/rows.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { sameWords } from '../../gpu/core/sameWords.ts'

/** The far-field objects of a runtime's cut as its filter holds them (`farFieldOf`). */
export type FarField = {
  /** The cut's filter bits (`../../geometry/selection/viewFilter.ts`): a bit a placement, set when
   *  the primed draw leaves it out — every placement whose node does not set `farField`. The
   *  array's identity is the set's revision; none while no placement is flagged. */
  bits: Uint32Array | undefined
  /** The placements whose node sets `farField`. */
  count: number
}

/** What a set was read under: the roots held, the node fields written, the scene's revision, the
 *  rows' flags moved. */
type Read = { roots: number; writes: number; revision: number; rows: number; held: FarField }

const reads = new WeakMap<object, Read>()

/**
 * THE PLACEMENTS OF THE PRIMED DRAW: those whose node sets `farField` (`Object3D.farField`), as the
 * filter bits the cut leaves the others out by — a placed row of a streamed cell by its own flag
 * (`PlacementRows.farField`). Read again only when the roots, a node field, a row's flag or the
 * scene moved; a set that did not change is the array it was, so the cut in hand stands and the GPU
 * holds its bits already (`../../geometry/dag/viewFilterRegion.ts`).
 */
export function farFieldOf(rt: WebgpuPagesRuntime): FarField {
  const roots = rt.layout.selectionRoots,
    writes = nodeWrites(),
    revision = rt.run.gate.revisions.scene,
    rows = rowFarFieldMoves()
  const read = reads.get(rt)
  if (
    read &&
    read.roots === roots.length &&
    read.writes === writes &&
    read.revision === revision &&
    read.rows === rows
  )
    return read.held
  const words = Math.max(1, ceilDiv(roots.length, 32)),
    bits = new Uint32Array(words).fill(0xffffffff)
  // Past the last root a bit names no placement: left clear.
  const used = roots.length - 32 * (words - 1)
  if (used < 32) bits[words - 1] = used > 0 ? (1 << used) - 1 : 0
  let count = 0
  for (let rank = 0; rank < roots.length; rank++) {
    if (!rootSource(roots[rank])?.farField && !rowFarField(roots[rank].placement)) continue
    bits[rank >> 5] &= ~(1 << (rank & 31))
    count++
  }
  const before = read?.held
  const same =
    before && before.count === count && sameBits(before.bits, count > 0 ? bits : undefined)
  const held: FarField = same ? before : { bits: count > 0 ? bits : undefined, count }
  reads.set(rt, { roots: roots.length, writes, revision, rows, held })
  return held
}

const sameBits = (a: Uint32Array | undefined, b: Uint32Array | undefined) =>
  a === b || (!!a && !!b && sameWords(a, b))
