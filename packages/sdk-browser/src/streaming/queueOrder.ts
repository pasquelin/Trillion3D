import { createHeap } from '../../../math/src/sequence/heap.ts'

/** What the queue reads of a job: its priority, its arrival number, the bytes its transfer holds,
 *  and its place in the heap. */
type Queued = { priority: number; order: number; bytes: number; slot: number }

/** Whether `a` leaves before `b`: the smaller priority, then the earlier arrival. */
const before = (a: Queued, b: Queued) =>
  a.priority < b.priority || (a.priority === b.priority && a.order < b.order)

/**
 * The queue of a streamer's jobs: a heap on (priority, arrival) (`math/src/sequence/heap.ts`), each job's place in it
 * kept in `slot`, −1 once out of it. A job is queued, leaves first or is taken out wherever it
 * stands in O(log n), and one whose priority rose climbs to its place: a camera asking thousands of
 * reads never pays a sweep of the queue. A lower bound of the bytes a queued job holds is kept
 * (`least`), made exact by a search none passes, so a budget none fits is known at once and never
 * rescans the queue; the places a search visits are a heap of their own, reused.
 */
export function createJobHeap<T extends Queued>() {
  const heap = createHeap<T>(before, (job, at) => (job.slot = at)),
    jobs = heap.items
  /** The places a search visits, the job first in the queue's order first. */
  const open = createHeap<number>((a, b) => before(jobs[a], jobs[b]))
  let least = Infinity
  const queued = (job: T) => jobs[job.slot] === job
  /** The children of `at` join the places to visit. */
  const visit = (at: number) => {
    const left = 2 * at + 1
    if (left < jobs.length) open.push(left)
    if (left + 1 < jobs.length) open.push(left + 1)
  }
  return {
    get size() {
      return jobs.length
    },
    push(job: T) {
      heap.push(job)
      least = Math.min(least, job.bytes)
    },
    /** Takes `job` out wherever it stands; false when it is not queued. */
    remove(job: T) {
      if (!queued(job)) return false
      heap.take(job.slot)
      job.slot = -1
      if (!jobs.length) least = Infinity
      return true
    },
    /** The first job, in the queue's order, whose bytes fit in `room`, left in place: those before
     *  it are visited in order, each child after its parent, and none is moved. A search none
     *  passes visited every job: the smallest it saw is the exact `least`. */
    first(room: number) {
      if (!jobs.length || jobs[0].bytes <= room) return jobs[0] as T | undefined
      open.clear()
      let smallest = jobs[0].bytes
      for (let at = 0; ;) {
        visit(at)
        if (!open.size) return void (least = smallest)
        at = open.take()!
        if (jobs[at].bytes <= room) return jobs[at]
        smallest = Math.min(smallest, jobs[at].bytes)
      }
    },
    /** A lower bound of the bytes a queued job holds, `Infinity` for an empty queue. */
    least: () => least,
    /** `job`'s priority rose: it climbs to its place, if queued. */
    raise(job: T) {
      if (queued(job)) heap.settle(job.slot)
    },
    clear() {
      for (const job of jobs) job.slot = -1
      heap.clear()
      least = Infinity
    },
  }
}

export type JobHeap<T extends Queued> = ReturnType<typeof createJobHeap<T>>

/**
 * The first job of `heap` the transfer budget lets go, taken out, or `undefined`: those it passes
 * over stay where they are. The first transfer always leaves: without it nothing would move when a
 * single page exceeds the budget.
 */
export function takeAdmissible<T extends Queued>(
  heap: JobHeap<T>,
  active: number,
  activeBytes: number,
  maxTransferBytes: number,
) {
  const room = active === 0 ? Infinity : maxTransferBytes - activeBytes
  // Not even the least a queued job may hold fits: none does, known at once.
  if (heap.least() > room) return undefined
  const job = heap.first(room)
  if (job) heap.remove(job)
  return job
}
