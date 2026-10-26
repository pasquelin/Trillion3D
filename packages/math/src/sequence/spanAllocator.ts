/**
 * THE ONE ALLOCATOR OF RUNS OF INDICES: the home of every range whose records the GPU names by their
 * first index — the cards, mesh cards and pages of the surface cache, the words of the mesh fields'
 * indirection tables.
 *
 * A run is the first free run, lowest first, that is long enough, else the range grows. A run given
 * back waits to be joined to its neighbours: until `consolidate`, or until an allocation finds no room
 * in the free runs it knows. The range shrinks by the free run at its end when it is consolidated; a
 * grow-only allocator reports the largest the range has been (`extent`), for a buffer that never
 * shrinks.
 */

/** A run of indices, `length` of them from `start`. */
interface Run {
  start: number
  length: number
}

/** The index of the first run of `runs` from `from` that holds `length` indices, else -1. */
function firstFit(runs: readonly Run[], length: number, from: number) {
  for (let at = from; at < runs.length; at++) if (runs[at].length >= length) return at
  return -1
}

/** The free runs of a range that grows and shrinks. */
interface Runs {
  /** One past the last index that may be allocated. */
  extent: number
  /** The most `extent` has been. */
  peak: number
  /** The free runs, ordered, as of the last consolidation. */
  free: Run[]
  /** The runs given back since. */
  readonly given: Run[]
  /** The first run of `free` that may not be empty: those before it are used up. */
  first: number
}

/** Joins the runs given back to the free ones and drops the empty ones; the free run that ends the
 *  range is returned to it. */
function consolidate(runs: Runs) {
  const { free, given } = runs
  if (given.length === 0 && runs.first === 0) return
  given.sort((a, b) => a.start - b.start)
  const merged: Run[] = []
  let end = -1,
    fromFree = 0,
    fromGiven = 0
  while (fromFree < free.length || fromGiven < given.length) {
    const next =
      fromGiven < given.length &&
      (fromFree >= free.length || given[fromGiven].start < free[fromFree].start)
        ? given[fromGiven++]
        : free[fromFree++]
    if (next.length <= 0) continue
    if (end === next.start) merged[merged.length - 1].length += next.length
    else merged.push({ start: next.start, length: next.length })
    const last = merged[merged.length - 1]
    end = last.start + last.length
  }
  const last = merged[merged.length - 1]
  if (last && last.start + last.length === runs.extent) {
    runs.extent -= last.length
    merged.pop()
  }
  runs.free = merged
  given.length = 0
  runs.first = 0
}

/** The first index of a run of `length` indices: the first free run that holds it, else the end of
 *  the range, which grows. */
function allocateRun(runs: Runs, length: number) {
  let at = firstFit(runs.free, length, runs.first)
  if (at < 0 && runs.given.length > 0) {
    consolidate(runs)
    at = firstFit(runs.free, length, runs.first)
  }
  if (at >= 0) {
    const run = runs.free[at]
    // A run used up stays in the list, empty, until the next consolidation.
    runs.free[at] = { start: run.start + length, length: run.length - length }
    if (run.length === length && runs.first === at) runs.first = at + 1
    return run.start
  }
  const start = runs.extent
  runs.extent += length
  runs.peak = Math.max(runs.peak, runs.extent)
  return start
}

/** The free runs of an empty range; `growOnly`, a range whose `extent` never falls. */
export function createSpanAllocator(growOnly = false) {
  const runs: Runs = { extent: 0, peak: 0, free: [], given: [], first: 0 }
  return {
    /** The first index of a run of `length` indices. */
    allocate: (length: number) => allocateRun(runs, length),
    /** Gives back the run of `length` indices at `start`. */
    release(start: number, length: number) {
      runs.given.push({ start, length })
    },
    /** Joins the runs given back to the free ones, and gives back the room past the last one in use. */
    consolidate: () => consolidate(runs),
    /** One past the last index that may be in use: the largest it has been where it only grows. */
    get extent() {
      return growOnly ? runs.peak : runs.extent
    },
  }
}
