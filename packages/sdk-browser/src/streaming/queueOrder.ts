/** What the queue reads of a job: its priority, its arrival number, the bytes its transfer holds,
 *  and its place in the heap. */
type Queued = { priority: number; order: number; bytes: number; slot: number }

/** Whether `a` leaves before `b`: the smaller priority, then the earlier arrival. */
const before = (a: Queued, b: Queued) =>
  a.priority < b.priority || (a.priority === b.priority && a.order < b.order)

/** `job` at `at` of `heap`, its place noted. */
function place<T extends Queued>(heap: T[], job: T, at: number) {
  heap[at] = job
  job.slot = at
}

/** The job at `at` of `heap` climbs while it leaves before its parent. */
function up<T extends Queued>(heap: T[], at: number) {
  const job = heap[at]
  for (let parent = (at - 1) >> 1; at > 0 && before(job, heap[parent]); parent = (at - 1) >> 1) {
    place(heap, heap[parent], at)
    at = parent
  }
  place(heap, job, at)
}

/** The job at `at` of `heap` sinks while a child leaves before it. */
function down<T extends Queued>(heap: T[], at: number) {
  const job = heap[at]
  for (let child = 2 * at + 1; child < heap.length; child = 2 * at + 1) {
    if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++
    if (!before(heap[child], job)) break
    place(heap, heap[child], at)
    at = child
  }
  place(heap, job, at)
}

/**
 * The queue of a streamer's jobs: a binary heap on (priority, arrival), each job's place in it kept
 * in `slot`, −1 once out of it. A job is queued, leaves first or is taken out wherever it stands in
 * O(log n), and one whose priority rose climbs to its place: a camera asking thousands of reads
 * never pays a sweep of the queue.
 */
export function createJobHeap<T extends Queued>() {
  const heap: T[] = []
  /** Takes `job` out wherever it stands; false when it is not queued. */
  const remove = (job: T) => {
    const at = job.slot
    if (heap[at] !== job) return false
    job.slot = -1
    const last = heap.pop()!
    if (last === job) return true
    place(heap, last, at)
    up(heap, at)
    down(heap, last.slot)
    return true
  }
  return {
    get size() {
      return heap.length
    },
    push(job: T) {
      place(heap, job, heap.length)
      up(heap, job.slot)
    },
    /** The first job, taken out; `undefined` for an empty queue. */
    pop() {
      const first = heap[0]
      if (first) remove(first)
      return first as T | undefined
    },
    remove,
    /** `job`'s priority rose: it climbs to its place, if queued. */
    raise(job: T) {
      if (heap[job.slot] === job) up(heap, job.slot)
    },
    clear() {
      for (const job of heap) job.slot = -1
      heap.length = 0
    },
  }
}

export type JobHeap<T extends Queued> = ReturnType<typeof createJobHeap<T>>

/**
 * The first job of `heap` the transfer budget lets go, taken out, or `undefined`: those it passes
 * over stay queued. The first transfer always leaves: without it nothing would move when a single
 * page exceeds the budget.
 */
export function takeAdmissible<T extends Queued>(
  heap: JobHeap<T>,
  active: number,
  activeBytes: number,
  maxTransferBytes: number,
) {
  const passed: T[] = []
  let job = heap.pop()
  while (job && active > 0 && activeBytes + job.bytes > maxTransferBytes) {
    passed.push(job)
    job = heap.pop()
  }
  for (const over of passed) heap.push(over)
  return job
}
