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

/** The first job of `heap`, in its order, whose bytes fit in `room`, or `undefined`: those before
 *  it are read in order — `open`, a heap of the places still to visit, each child after its
 *  parent, emptied first —, and none is moved. */
function first<T extends Queued>(heap: readonly T[], open: number[], room: number) {
  if (!heap.length || heap[0].bytes <= room) return heap[0]
  open.length = 0
  const visit = (at: number) => {
    if (at >= heap.length) return
    let slot = open.push(at) - 1
    for (let parent = (slot - 1) >> 1; slot > 0; parent = (slot - 1) >> 1) {
      if (!before(heap[open[slot]], heap[open[parent]])) break
      ;[open[slot], open[parent]] = [open[parent], open[slot]]
      slot = parent
    }
  }
  for (let at = 0; ;) {
    visit(2 * at + 1)
    visit(2 * at + 2)
    if (!open.length) return undefined
    at = takeFirst(heap, open)
    if (heap[at].bytes <= room) return heap[at]
  }
}

/** The place of `open`, a heap of places of `heap`, whose job leaves first: taken out. */
function takeFirst<T extends Queued>(heap: readonly T[], open: number[]) {
  const top = open[0],
    last = open.pop()!
  if (!open.length) return top
  let slot = 0
  open[0] = last
  for (let child = 1; child < open.length; child = 2 * slot + 1) {
    if (child + 1 < open.length && before(heap[open[child + 1]], heap[open[child]])) child++
    if (!before(heap[open[child]], heap[open[slot]])) break
    ;[open[slot], open[child]] = [open[child], open[slot]]
    slot = child
  }
  return top
}

/**
 * The queue of a streamer's jobs: a binary heap on (priority, arrival), each job's place in it kept
 * in `slot`, −1 once out of it. A job is queued, leaves first or is taken out wherever it stands in
 * O(log n), and one whose priority rose climbs to its place: a camera asking thousands of reads
 * never pays a sweep of the queue. The smallest bytes a queued job holds are kept (`least`), so a
 * budget none fits is known at once; the places a search visits reuse one list.
 */
export function createJobHeap<T extends Queued>() {
  const heap: T[] = [],
    open: number[] = []
  /** The smallest bytes a queued job holds, and how many jobs hold them. */
  let least = Infinity,
    holding = 0
  const counted = (bytes: number) => {
    if (bytes < least) [least, holding] = [bytes, 1]
    else if (bytes === least) holding++
  }
  /** Takes `job` out wherever it stands; false when it is not queued. */
  const remove = (job: T) => {
    const at = job.slot
    if (heap[at] !== job) return false
    job.slot = -1
    const last = heap.pop()!
    if (last !== job) {
      place(heap, last, at)
      up(heap, at)
      down(heap, last.slot)
    }
    // The last of the smallest left: the next smallest is found once.
    if (job.bytes === least && --holding === 0) {
      least = Infinity
      for (const each of heap) counted(each.bytes)
    }
    return true
  }
  return {
    get size() {
      return heap.length
    },
    push(job: T) {
      place(heap, job, heap.length)
      up(heap, job.slot)
      counted(job.bytes)
    },
    /** The first job, taken out; `undefined` for an empty queue. */
    pop() {
      const first = heap[0]
      if (first) remove(first)
      return first as T | undefined
    },
    remove,
    /** The first job, in the queue's order, whose bytes fit in `room`, left in place (`first`). */
    first: (room: number) => first(heap, open, room),
    /** The smallest bytes a queued job holds, `Infinity` for an empty queue. */
    least: () => least,
    /** `job`'s priority rose: it climbs to its place, if queued. */
    raise(job: T) {
      if (heap[job.slot] === job) up(heap, job.slot)
    },
    clear() {
      for (const job of heap) job.slot = -1
      heap.length = 0
      ;[least, holding] = [Infinity, 0]
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
  // The smallest queued job does not fit: none does, known at once.
  if (heap.least() > room) return undefined
  const job = heap.first(room)
  if (job) heap.remove(job)
  return job
}
