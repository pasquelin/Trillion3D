/**
 * THE TRANSFER QUEUE: the jobs in their heap (`queueOrder.ts`), and those that read a range of a
 * file (`StreamPage.range`) indexed by where their range starts and ends in it. A transfer that
 * starts takes the first job its budget admits (`takeAdmissible`), and with it every queued range
 * end to end with its own in the same file, before and after, while their bytes fit what the budget
 * leaves: one request reads them all (`fetch.ts`). Ranges asked within a task are queued before
 * the pump runs (`queue.ts`), so the bundles a frame's cells ask side by side in the binary are one
 * request, and a transfer under load takes what queued meanwhile.
 *
 * Cost, for q queued jobs and m ranges merged: O(log q) a job queued or taken out, O(m log q) a
 * transfer that merges m, two map lookups per neighbour; nothing per frame.
 */
import { createJobHeap, takeAdmissible } from './queueOrder.ts'
import type { Job } from './types.ts'

/** Each file's queued ranges by one end: where they start, or where they end. */
type Ends = Map<string, Map<number, Job>>

const endOf = (job: Job) => job.range!.offset + job.bytes

/** `job` at `at` of `file` in `ends`. */
function put(ends: Ends, file: string, at: number, job: Job) {
  let own = ends.get(file)
  if (!own) ends.set(file, (own = new Map()))
  own.set(at, job)
}

/** `job` at `at` of `file` out of `ends`, if it is the one there. */
function unput(ends: Ends, file: string, at: number, job: Job) {
  const own = ends.get(file)
  if (own?.get(at) !== job) return
  own.delete(at)
  if (!own.size) ends.delete(file)
}

/** The queued ranges end to end with `job`'s in its file, by `starts` and `ends`, while `room`
 *  bytes are left: those before it, nearest first, then those after. */
function around(starts: Ends, ends: Ends, job: Job, room: number) {
  const { file, offset } = job.range!,
    before: Job[] = [],
    after: Job[] = []
  const left = ends.get(file),
    right = starts.get(file)
  for (let at = offset, next = left?.get(at); next && next.bytes <= room; next = left?.get(at)) {
    before.push(next)
    room -= next.bytes
    at = next.range!.offset
  }
  for (
    let at = endOf(job), next = right?.get(at);
    next && next.bytes <= room;
    next = right?.get(at)
  ) {
    after.push(next)
    room -= next.bytes
    at = endOf(next)
  }
  return { before, after }
}

export function createTransferQueue() {
  const heap = createJobHeap<Job>()
  const starts: Ends = new Map(),
    ends: Ends = new Map()
  const unindex = (job: Job) => {
    if (!job.range) return
    unput(starts, job.range.file, job.range.offset, job)
    unput(ends, job.range.file, endOf(job), job)
  }
  const remove = (job: Job) => heap.remove(job) && (unindex(job), true)
  return {
    get size() {
      return heap.size
    },
    push(job: Job) {
      heap.push(job)
      if (!job.range) return
      put(starts, job.range.file, job.range.offset, job)
      put(ends, job.range.file, endOf(job), job)
    },
    /** Takes `job` out wherever it stands; false when it is not queued. */
    remove,
    raise: heap.raise,
    /** The jobs the next transfer reads, in file order for ranges, taken out; `undefined` when
     *  the budget admits none. */
    take(active: number, activeBytes: number, maxTransferBytes: number) {
      const job = takeAdmissible(heap, active, activeBytes, maxTransferBytes)
      if (!job?.range) return job && [job]
      unindex(job)
      const room = Math.max(job.bytes, maxTransferBytes - activeBytes) - job.bytes
      const { before, after } = around(starts, ends, job, room)
      const run = [...before.reverse(), job, ...after]
      for (const each of run) if (each !== job) remove(each)
      return run
    },
    clear() {
      heap.clear()
      starts.clear()
      ends.clear()
    },
  }
}

export type TransferQueue = ReturnType<typeof createTransferQueue>
