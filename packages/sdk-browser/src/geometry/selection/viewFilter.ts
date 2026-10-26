import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { ViewSet } from '../../../../sdk-core/src/world/camera/viewSet.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { clearBit, setBit } from '../../../../math/src/scalar/bits.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'

/** The ranks of the roots drawn from `node` or anything under it, written into `out` from `at` on;
 *  where they end (`../../frame/render/movedNode.ts`, `appendRootsUnder`). */
export type RootsUnder = (node: Object3D, out: number[], at: number) => number

type Seen = { set?: ViewSet; roots: number; revision: number; forced?: readonly number[] }

/** Whether the filter was last made for this very view set, root count, revision and forced
 *  roots. */
const sameAsSeen = (
  seen: Seen | undefined,
  set: ViewSet | undefined,
  rootCount: number,
  revision: number,
  forced: readonly number[] | undefined,
) =>
  seen !== undefined &&
  seen.set === set &&
  seen.roots === rootCount &&
  seen.revision === revision &&
  seen.forced === forced

/** The bits of the roots the view does not draw, written into `bits` (`rootCount` roots). */
function fillBits(
  bits: Uint32Array,
  set: ViewSet | undefined,
  rootCount: number,
  under: RootsUnder,
  ranks: number[],
  forced: readonly number[] | undefined,
) {
  const words = bits.length
  bits.fill(set?.showOnly ? 0xffffffff : 0)
  // Past the last root a bit names no placement: left clear.
  const used = rootCount - 32 * (words - 1)
  if (used < 32) bits[words - 1] &= used > 0 ? (1 << used) - 1 : 0
  if (set?.showOnly)
    for (const node of set.showOnly) mark(bits, node, under, ranks, rootCount, false)
  for (const node of set?.hidden ?? []) mark(bits, node, under, ranks, rootCount, true)
  for (const rank of forced ?? []) if (rank < rootCount) setBit(bits, rank)
}

/**
 * THE BITS OF A VIEW'S FILTER (`Camera.hidden`, `Camera.showOnly`,
 * `../../../../sdk-core/src/contracts/viewOptions.ts`): a bit a root, by its rank — the placement
 * the cut reads it by —, set when the view does not draw it. Without `showOnly` every root is
 * drawn but those under a hidden object; with it, only those under an object it names, and
 * `hidden` still wins. A list entry stands for the object and everything under it, read where the
 * scene holds it now: the roots under each listed object, not every root, are walked
 * (`RootsUnder`), so a filter costs what it names. A view with no filter has no bits and costs
 * nothing: `update` answers `undefined`.
 *
 * Beside the view's lists, the roots `forced` names — the ones the view does not draw whatever it
 * lists: an object hidden from the view that owns it (`firstPersonWorldSpaceRepresentation`), one that
 * casts its shadow while hidden (`castHiddenShadow`) — are set last, as `hidden` is.
 *
 * `update` answers the array it answered before when the bits did not change, so that the
 * identity of the array is the revision of the filter — the cut in hand stands
 * (`sameSelectionUniforms`) and the GPU holds the bits already (`../dag/viewFilterRegion.ts`)
 * —, and reads the scene again only when the view's set, the roots or the scene's `revision`
 * moved.
 */
export function createViewFilter() {
  let held: Uint32Array | undefined,
    scratch = new Uint32Array(0),
    seen: Seen | undefined
  const ranks: number[] = []
  return {
    update(
      set: ViewSet | undefined,
      rootCount: number,
      under: RootsUnder,
      revision: number,
      forced?: readonly number[],
    ) {
      const listed = !!set && (set.hidden.length > 0 || set.showOnly !== null)
      if (!listed && !forced?.length) {
        seen = undefined
        return (held = undefined)
      }
      if (sameAsSeen(seen, set, rootCount, revision, forced)) return held
      seen = { set, roots: rootCount, revision, forced }
      const words = Math.max(1, bitWords(rootCount))
      if (scratch.length < words) scratch = new Uint32Array(words)
      const bits = scratch.subarray(0, words)
      fillBits(bits, set, rootCount, under, ranks, forced)
      return (held = held && sameValues(held, bits) ? held : bits.slice())
    },
  }
}

/** The roots under `node` set (`set`) or cleared in `bits`. */
function mark(
  bits: Uint32Array,
  node: Object3D,
  under: RootsUnder,
  ranks: number[],
  rootCount: number,
  set: boolean,
) {
  const end = under(node, ranks, 0)
  for (let k = 0; k < end; k++) {
    const rank = ranks[k]
    if (rank >= rootCount) continue
    if (set) setBit(bits, rank)
    else clearBit(bits, rank)
  }
}
