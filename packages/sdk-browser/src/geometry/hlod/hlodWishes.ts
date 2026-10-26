/**
 * THE CELLS ABOVE HLOD 0 THE VIEW WISHES, grid by grid (`hlodCells.ts`): each grid's cells are
 * found around the eye in buckets of their own, one bucket a grid's reach wide (`createGridBuckets`,
 * `hlodBuckets.ts`), and a cell above HLOD 0 is wished while the view's shape for its grid's range
 * meets the bounds it streams by (`StreamingSource.meets`), or while a wished cell of a grid that
 * asks it pulls it in (`hlodPulls.ts`). Each frame (`measure`) the cells entering or leaving a
 * grid's range alone are told again; one wished no more loses its turn to load, its children's
 * loads weighed again. A reach that moved files the cells again, and the cells are measured again
 * from an eye that stood when the view's shape turns with it (`StreamingSource.turns`) or one of
 * its settings moved (`StreamingSource.revision`).
 *
 * Cost, for G grids and n cells within a grid's range: O(C) once at creation, C the chain's cells,
 * then per eye move O(G · n); nothing while the eye, the shape and the settings stand.
 */
import type { WorldRootsHold } from './worldRoots.ts'
import { createGridBuckets } from './hlodBuckets.ts'
import type { HlodPulls } from './hlodPulls.ts'
import type { StreamingSource } from '../partition/source.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import { keepNumbers } from '../../../../math/src/vector/vector.ts'
import { entryOf } from '../../../../math/src/sequence/counts.ts'

/** What a measure flags and tells: the cells wished (`wished`: 1 wished, 2 kept, 3 entering at a
 *  measure) and started, and a cell that enters or leaves told to `tell`, one that leaves with its
 *  turn lost, its children's loads weighed again, to `weighChildren`. */
type WishedCells = {
  wished: Uint8Array
  started: Uint8Array
  tell(cell: number): void
  weighChildren(cell: number): void
}

const newPair = (): [number[], number[]] => [[], []]

/** The cells of `before` that no longer meet the view — wished before, not met now (`wished` still
 *  1): unwished, the turn of one that started lost, each told again. */
function leave(before: readonly number[], { wished, started, tell, weighChildren }: WishedCells) {
  for (const cell of before) {
    if (wished[cell] !== 1) continue
    wished[cell] = 0
    if (started[cell]) {
      started[cell] = 0
      weighChildren(cell)
    }
    tell(cell)
  }
}

/** `cell` met by a measure into the list `met`: kept (2) when it was wished, else entering (3) and
 *  told again. */
function meetInto(met: number[], cell: number, { wished, tell }: WishedCells) {
  met.push(cell)
  if (wished[cell]) wished[cell] = 2
  else {
    wished[cell] = 3
    tell(cell)
  }
}

/** The cells above HLOD 0 of `chain` the view `source` wishes on `grids`, as `pulls` pull more in,
 *  flagged and told through `cells`. */
export function createWishes(
  chain: NonNullable<WorldRootsHold['table']>['chain'],
  grids: readonly PartitionGrid[],
  source: StreamingSource,
  pulls: Pick<HlodPulls, 'on' | 'pulled'> | undefined,
  cells: WishedCells,
) {
  const { wished } = cells
  let buckets = createGridBuckets(chain, grids, source)
  /** The eye and the revision of the view's shape the cells were last measured under. */
  const seenEye = new Float64Array(3).fill(NaN)
  let seenShape = -1
  /** Per grid, the cells above HLOD 0 wished now and the list the next measure fills, swapped. */
  const lists = new Map<number, [number[], number[]]>()
  /** The list a measure fills, and each cell met into it: kept (2) or entering (3), told again. */
  let meeting: number[] = []
  const meet = (cell: number) => meetInto(meeting, cell, cells)
  return {
    /** Each grid's cells wished now, first of its pair of lists. */
    lists: lists as ReadonlyMap<number, readonly [readonly number[], readonly number[]]>,
    /** Each upper cell's wish from `eye`, the cells entering or leaving their range told again; one
     *  wished no more loses its turn, its children's loads weighed again. */
    measure(eye: ArrayLike<number>) {
      if (buckets.stale()) {
        buckets = createGridBuckets(chain, grids, source)
        seenEye.fill(NaN)
      }
      const eyeStood = keepNumbers(seenEye, eye),
        shapeStood = source.revision === seenShape
      seenShape = source.revision
      if (eyeStood && shapeStood && !source.turns()) return
      for (const grid of buckets.grids()) {
        const pair = entryOf(lists, grid, newPair)
        const [before, now] = pair
        now.length = 0
        meeting = now
        buckets.near(grid, eye[0], eye[2], meet)
        // Wished too: those the wished cells of a grid that asks it pull in (`hlodPulls.ts`).
        for (const cell of pulls?.on(grid) ?? [])
          if (chain.level[cell] && pulls!.pulled(cell)) meet(cell)
        // Wished before and not met now: leaving.
        leave(before, cells)
        for (const cell of now) wished[cell] = 1
        pair[0] = now
        pair[1] = before
      }
    },
    /** Every cell forgotten: the next measure starts anew. */
    clear() {
      lists.clear()
      seenEye.fill(NaN)
    },
  }
}
