import { WORLD_SPACE_ROOT } from '../../visibility/shader/castingMark.ts'
import { castsWhileHidden } from '../../placement/hidden.ts'

/** What of a root the views' rule reads (`ClusterRoot`). */
type ViewRoot = { hidden?: boolean; mark?: number }

/** The facts kept of a root, one bit each: it is hidden and casts while hidden, it stands for a first-person object, its object hides from
 *  its owner or from all but its owner. */
const CASTER = 1,
  STAND_IN = 2,
  VIEWED = 4

/**
 * THE ROOTS THE VIEWS MAY NOT DRAW, kept sparse, a word of facts a rank (`hiddenFromViews` reads them): the roots that are hidden and cast while hidden
 * (`CASTER`), the stand-ins of first-person objects (`STAND_IN`, the mark `WORLD_SPACE_ROOT`) and the roots whose object hides from
 * its owner or from all but its owner (`VIEWED`, the bits `OBJECT_OWNER_NO_SEE` and `OBJECT_ONLY_OWNER_SEE` of its row, written by
 * `offsetReach.ts`). The first two are kept where a root is shown, hidden or marked (`note`, from `settleRoot`: every change of a root's
 * mark or visibility passes there), the third where its row is read (`setViewed`); the roots past the session's count are forgotten
 * (`sync`). A change drops the lists derived from them (`lists`, per owner), as does a move of what they are derived with — the
 * scene (a node re-parented puts a root under another owner, whatever the facts say) and the roots' index by node (`sync`).
 */
export function createViewHidden() {
  const facts = new Map<number, number>()
  let length = -1,
    revision = -1,
    scene = -1,
    lists = new WeakMap<object, number[]>(),
    ranks: number[] | undefined,
    standInRanks: number[] | undefined
  const changed = () => {
    lists = new WeakMap()
    ranks = standInRanks = undefined
  }
  /** Sets or clears `bit` of root `rank`'s facts; idempotent. */
  const toggle = (rank: number, bit: number, on: boolean) => {
    const was = facts.get(rank) ?? 0,
      now = on ? was | bit : was & ~bit
    if (now === was) return
    if (now) facts.set(rank, now)
    else facts.delete(rank)
    changed()
  }
  /** The roots from rank `count` on are forgotten: the session holds fewer roots than it did. */
  const trim = (count: number) => {
    let any = false
    for (const rank of facts.keys())
      if (rank >= count) {
        facts.delete(rank)
        any = true
      }
    if (any) changed()
  }
  const has = (rank: number, bit: number) => ((facts.get(rank) ?? 0) & bit) !== 0
  const ranksWith = (bit: number) =>
    [...facts]
      .filter(([, held]) => (held & bit) !== 0)
      .map(([rank]) => rank)
      .sort((a, b) => a - b)
  return {
    /** Root `rank` is hidden and casts while hidden, and it stands for a first-person object, or not. */
    note(rank: number, root: ViewRoot) {
      toggle(rank, CASTER, !!root.hidden && castsWhileHidden(root))
      toggle(rank, STAND_IN, ((root.mark ?? 0) & WORLD_SPACE_ROOT) !== 0)
    },
    /** Whether root `rank` hides from some view whatever its lists say (`VIEWED`), or not: its bits changed. */
    setViewed: (rank: number, on: boolean) => toggle(rank, VIEWED, on),
    trim,
    /** The session holds `count` roots, indexed by node at `index` (`NodeIndex.revision`), under the scene's `sceneRevision`: the roots
     *  past `count` are forgotten, and the lists are dropped once any of the three moved from the last call. */
    sync(count: number, index: number, sceneRevision: number) {
      if (count < length) trim(count)
      if (count !== length || index !== revision || sceneRevision !== scene) changed()
      length = count
      revision = index
      scene = sceneRevision
    },
    isCaster: (rank: number) => has(rank, CASTER),
    isStandIn: (rank: number) => has(rank, STAND_IN),
    /** The list of the roots a view does not draw, by what it names its owner by: made by the caller, dropped by a change. */
    get lists() {
      return lists
    },
    /** The ranks that may be hidden from a view, ascending: those with a fact. */
    get ranks() {
      return (ranks ??= [...facts.keys()].sort((a, b) => a - b))
    },
    /** The ranks of the stand-ins of first-person objects, ascending. */
    get standInRanks() {
      return (standInRanks ??= ranksWith(STAND_IN))
    },
  }
}

export type ViewHidden = ReturnType<typeof createViewHidden>
